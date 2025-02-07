import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Step } from '../proxy-page.step';
import { ContextService } from '../../context/context.service';

/* eslint-disable no-useless-escape, prefer-regex-literals */
export default (config: ConfigService, http: HttpService): Step => async (context: ContextService): Promise<void> => {
  const logger = new Logger('fixLinks');
  context.setPerfMark('fixLinks');

  const $ = context.getCheerioBody();
  const confluenceBaseURL = config.get('confluence.baseURL');
  const webBasePath = config.get('web.absoluteBasePath');

  const confluenceHomepageClass = 'confluence-homepage';
  const atlassianResourcesURL = 'https://sanofi.atlassian.net/jira';

  const isValidURL = (favicon: string) => {
    try {
      const url = new URL(favicon);
      const protocols = ['http:', 'https:'];
      return protocols.includes(url.protocol);
    } catch (_) {
      return false;
    }
  };

  const createImagePath = (favicon: string, url: string) => {
    if (favicon) {
      const base = new URL(url).origin;
      return isValidURL(favicon) ? favicon : `${base}${favicon}`;
    }
    return '';
  };

  const isCounfluenceHomepage = (link: cheerio.Element) =>
    link?.attribs?.classname === confluenceHomepageClass;

  const isAtlassianResources = (element: cheerio.Element) =>
    element?.attribs?.href?.startsWith(atlassianResourcesURL);

  const titleFactory = (isAtlassian: boolean, body: cheerio.CheerioAPI) => {
    if (isAtlassian) {
      return body('nav h2').text();
    }
    return body('head title').text();
  };

  const faviconFactory = (isAtlassian: boolean, body: cheerio.CheerioAPI) => {
    if (isAtlassian) {
      return $(body('nav [style*="background-image"]').get())?.css('background-image')?.slice(5, -2) ?? '';
    }
    return (body('head link[rel="shortcut icon"]').attr('href') || body('head link[rel="icon"]').attr('href')) ?? '';
  };

  const toogleImageDisplayAttribiute = (link: cheerio.Element) => {
    const href = $(link).attr().src;
    if (!href || !href.length) {
      $(link).addClass('hidden');
    }
  };

  const returnValueCallbackBasedOnDestination = (url: string, element: cheerio.Element) => {
    if (!isAtlassianResources(element)) {
      return firstValueFrom(http.get(url));
    }
    return firstValueFrom(http.get(url, {
      auth: { username: config.get('confluence.apiUsername'), password: config.get('confluence.apiToken') },
    }));
  };

  // Confluence homepages
  $('a').each((_, anchor) => {
    const [, wikiKeyword, spacesKeyword, , , pagesKeywrod, pageID] = anchor?.attribs?.href?.split('/') ?? [];
    if (wikiKeyword && spacesKeyword && !pagesKeywrod && !pageID) {
      $(anchor).addClass(confluenceHomepageClass);
    }
  });

  $(`a.${confluenceHomepageClass}`).each((_, element: cheerio.Element & { children: { data: string }[] }) => {
    const childURL = element?.children[0]?.data;
    const isValidUrlFromChildren = isValidURL(childURL ?? '');
    const href = isValidUrlFromChildren ? childURL : element?.attribs?.href;
    $(element).replaceWith(`<a className="${confluenceHomepageClass}" target="_blank" href="${href}">${href}</a>`);
  });

  const homepageLinks = $(`a[className="${confluenceHomepageClass}"]`).toArray();

  const homepageLinksPromises = homepageLinks.map((element: cheerio.Element & { children: { data: string }[] }) => {
    const url = element?.children[0]?.data;
    return firstValueFrom(http.get(url))
      .then((res) => {
        const body = cheerio.load(res.data);
        const title = element.attribs.href.split('/spaces/')[1].trim();
        const favicon = body('head link[rel="shortcut icon"]').attr('href');
        const imagePath = createImagePath(favicon, url);
        const replacement = `<a target="_blank" href="${url}" className="${confluenceHomepageClass}">
          <img class="favicon" src="${imagePath}" /> ${title}
        </a>`;
        $(element).replaceWith(replacement);
      })
      .catch((error) => {
        console.log(`Smart link metadata fetch error: ${error}`); // eslint-disable-line no-console
      });
  });

  await Promise.all(homepageLinksPromises);

  // External links are tagged with the class external-link
  const externalLinksArray = $('a.external-link').toArray();
  $(externalLinksArray).each((_index: number, element: cheerio.Element) => {
    $(element).attr('target', '_blank');
  });

  // Inline & Card links display
  const externalLinksPromises = externalLinksArray.map((element: cheerio.Element) => {
    const url = $(element).attr('href');
    const dataCardAppearance = $(element).attr('data-card-appearance');
    if (!dataCardAppearance) {
      return null;
    }

    return returnValueCallbackBasedOnDestination(url, element).then((res) => {
      const body = cheerio.load(res.data);
      const isAtlassian = isAtlassianResources(element);
      const title = titleFactory(isAtlassian, body);
      const favicon = faviconFactory(isAtlassian, body);
      const description = body('head meta[name="description"]').attr(
        'content',
      ) ?? '';
      const imageSrc = body(
        'head meta[name="twitter:image:src"], head meta[name="og:image"]',
      ).attr('content');
      const imagePath = createImagePath(favicon, url);
      let replacement = '';
      if (dataCardAppearance === 'inline') {
        replacement = `<a target="_blank" href="${url}"> <img class="favicon" src="${imagePath}"/> ${title}</a>`;
      } else if (dataCardAppearance === 'block') {
        const imgTag = imageSrc ? `<img src="${imageSrc}"/>` : '';
        replacement = `
          <div class="card">
            <div class="thumb">${imgTag}</div>
            <div class="title-desc">
              <a target="_blank" href="${url}"> <img class="favicon" src="${imagePath}"/> ${title}</a>
              <p>${description}</p>
            </div>
          </div>`;
      }
      if (replacement) {
        $(element).replaceWith(replacement);
      }
    })
      .catch((error) => {
        console.log(`Smart link metadata fetch error: ${error}`); // eslint-disable-line no-console
      });
  });

  await Promise.all(externalLinksPromises);

  const domain = confluenceBaseURL.toString().replace(/https?:\/\//, '');
  // For direct Url and Uri we look for two patterns
  // $1 the domain to remove and $2 the rest of the URL to keep
  const searchUrl = new RegExp(`(https?://${domain}/wiki)(.*)`);
  const searchUri = new RegExp('^(\/wiki)(.*)');
  // For Url and Uri with anchor we look for four patterns
  // $1 the domain to remove, $2 the path of the pag, $3 the title and $4 the heading achor
  const searchUrlwithAnchor = new RegExp(
    `(https?://${domain}/wiki)(.*\/)(.*)#(.*)`,
  );
  const searchUriwithAnchor = new RegExp('^(\/wiki)(.*\/)(.*)#(.*)');

  const replaceAttributeLink = (attr: string, link: cheerio.Element) => {
    const [, , pathPageAnchorUrl, titlePageUrl, headingPageUrl] = searchUrlwithAnchor.exec($(link).attr(attr)) ?? [];
    const [, , pathPageAnchorUri, titlePageUri, headingPageUri] = searchUriwithAnchor.exec($(link).attr(attr)) ?? [];
    const [, , pathPageUrl] = searchUrl.exec($(link).attr(attr)) ?? [];
    const [, , pathPageUri] = searchUri.exec($(link).attr(attr)) ?? [];

    // ! Yet no solved the pattern when hyphen symbol is partin the title
    if (pathPageAnchorUrl) {
      $(link).attr(
        attr,
        `${webBasePath}/wiki${pathPageAnchorUrl}#`
            + `${titlePageUrl.replace(/\+/g, '')}-`
            + `${headingPageUrl.replace(/\-/g, '')}`,
      );
      // if there is no display text for the Url we try to compose one
      if ($(link).html() === '') {
        $(link).text(
          `${titlePageUrl.replace(/\+/g, ' ')} | ${headingPageUrl.replace(
            /\-/g,
            ' ',
          )}`,
        );
      }
    } else if (pathPageAnchorUri) {
      $(link).attr(
        attr,
        `${webBasePath}/wiki${pathPageAnchorUri}#`
            + `${titlePageUri.replace(/\+/g, '')}-`
            + `${headingPageUri.replace(/\-/g, '')}`,
      );
      // if there is no display text for the Url we try to compose one
      if ($(link).html() === '') {
        $(link).text(
          `${titlePageUri.replace(/\+/g, ' ')} | ${headingPageUri.replace(
            /\-/g,
            ' ',
          )}`,
        );
      }
    } else if (pathPageUrl) {
      // Step 1: replace absolute URLs by absolute URIs
      $(link).attr(attr, `${webBasePath}/wiki${pathPageUrl}`);
    } else if (pathPageUri) {
      // Step 2: replace URIs with the correct base path
      $(link).attr(attr, `${webBasePath}/wiki${pathPageUri}`);
    }

    // (Optional) Step 3: add resized URLs in srcset attribute on resized images
    if (link.tagName === 'img') {
      const imgWidth = link.attribs.width;
      // If the image has been resized, it had a width attribute
      if (imgWidth) {
        // Remove the old, wrong srcset links and add the new one with the corresponding width for standards
        // eslint-disable-next-line no-param-reassign
        link.attribs.srcset = `${link.attribs.src} ${imgWidth}w`;
      }
    }
  };

  // Let's find Confluence links to pages
  logger.log('Replacing links URLs');
  $('a').each((_index: number, link: cheerio.Element) => {
    if (!isCounfluenceHomepage(link)) {
      replaceAttributeLink('href', link);
    }
  });
  // Let's find Confluence links to images
  logger.log('Replacing images URLs');
  $('img').each((_index: number, link: cheerio.Element) => {
    toogleImageDisplayAttribiute(link);
    replaceAttributeLink('src', link);
  });

  // Remove links from user mentions
  $('a.confluence-userlink.user-mention').each(
    (_index: number, link: cheerio.Element) => {
      // eslint-disable-next-line no-param-reassign
      delete link.attribs.href;
    },
  );

  context.getPerfMeasure('fixLinks');
};
