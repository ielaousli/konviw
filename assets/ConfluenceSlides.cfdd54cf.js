import{o as s,c as t,a as n}from"./app.b235285c.js";import{_ as i}from"./plugin-vue_export-helper.21dcd24c.js";const o={name:"ConfluenceSlides",props:{pageId:{type:String,required:!0},styleId:{type:String,required:!0}},data(){return{iframeId:`konviw-slide-${this.pageId}`}},computed:{url:function(){return`https://konviw.vercel.app/cpv/wiki/slides/konviw/${this.pageId}?style=${this.styleId}`}}},a={class:"container"},c=["id","src"];function d(p,l,_,u,e,r){return s(),t("div",a,[n("iframe",{id:e.iframeId,src:r.url,scrolling:"no",class:"konviw--page"},null,8,c)])}var m=i(o,[["render",d],["__scopeId","data-v-61add142"]]);export{m as default};
