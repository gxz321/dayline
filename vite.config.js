import {defineConfig} from 'vite';
export default defineConfig(({mode})=>({base:mode==='github-pages'?'/dayline/':'/',define:{__DAYLINE_PAGES__:JSON.stringify(mode==='github-pages')},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:5173,strictPort:true},build:{target:'es2020'}}));
