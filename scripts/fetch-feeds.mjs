import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { SOURCES } from './sources.mjs';

const parser = new Parser({ timeout: 25000, customFields: { item: [['media:content','mediaContent',{keepArray:true}],['media:thumbnail','mediaThumbnail',{keepArray:true}],['content:encoded','contentEncoded',{keepArray:false}]] } });
const OUT = new URL('../site/data/articles.json', import.meta.url);
const hash = v => crypto.createHash('sha1').update(v).digest('hex').slice(0,16);
const strip = (v='') => String(v).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();
const excerpt = v => { const s=strip(v); return s.length<=230?s:`${s.slice(0,227).trimEnd()}…`; };
const arr = v => v ? (Array.isArray(v)?v:[v]) : [];
function urlOf(v){ if(!v) return ''; if(typeof v==='string') return v; if(typeof v==='object'){ if(typeof v.url==='string') return v.url; if(typeof v.href==='string') return v.href; for(const k of ['$','attrs','attribute','content']){const x=urlOf(v[k]); if(x) return x;} } return ''; }
function imageOf(item){ const xs=[item.enclosure?.url,item.enclosure?.href,...arr(item.mediaContent).map(urlOf),...arr(item.mediaThumbnail).map(urlOf)]; return xs.find(x=>/^https?:\/\//i.test(x||''))||''; }
function normalize(item,source){ const title=strip(item.title||'Untitled'); const link=item.link||item.guid||''; if(!/^https?:\/\//i.test(link)) return null; const published=item.isoDate||item.pubDate||item.published||item.updated||null; const summary=item.contentSnippet||item.contentEncoded||item.content||item.summary||item.description||''; return { id:hash(`${source.id}|${item.guid||link}`), title, link, publishedAt:published?(Number.isNaN(new Date(published).getTime())?null:new Date(published).toISOString()):null, excerpt:excerpt(summary), image:imageOf(item), source:{id:source.id,name:source.name,short:source.short,siteUrl:source.siteUrl,feedUrl:source.feedUrl,category:source.category,accent:source.accent} }; }
async function fetchOne(source){ const r=await fetch(source.feedUrl,{headers:{'user-agent':'AniNewsHub/1.0 (personal RSS reader)'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const feed=await parser.parseString(await r.text()); return (feed.items||[]).map(i=>normalize(i,source)).filter(Boolean); }
const all=[], errors=[];
for(const s of SOURCES){ try{ const items=await fetchOne(s); all.push(...items); console.log(`✓ ${s.name}: ${items.length}`); } catch(e){ errors.push({source:s.name,message:String(e?.message||e)}); console.error(`✗ ${s.name}: ${e?.message||e}`); } }
const unique=new Map(); for(const a of all){const k=a.link.replace(/\/+$/,'').toLowerCase(); if(!unique.has(k)) unique.set(k,a);}
const articles=[...unique.values()].sort((a,b)=>(Date.parse(b.publishedAt||0)||0)-(Date.parse(a.publishedAt||0)||0)).slice(0,500);
const payload={generatedAt:new Date().toISOString(),sources:SOURCES,stats:{sourceCount:SOURCES.length,successfulSources:SOURCES.length-errors.length,failedSources:errors.length,articleCount:articles.length},errors,articles};
await fs.writeFile(OUT,JSON.stringify(payload,null,2));
console.log(`Wrote ${articles.length} articles.`);
