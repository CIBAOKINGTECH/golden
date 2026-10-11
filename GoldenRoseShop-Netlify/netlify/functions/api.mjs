import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const store = () => getStore('golden-rose-shop');
const seed = [
  {id:'alma',name:'Cartera Alma',category:'Carteras',description:'Una cartera versátil en un delicado tono rosa empolvado. Ideal para acompañarte de día o completar un look especial.',price:1850,image:'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=80',badge:'Favorito'},
  {id:'siena',name:'Cartera Mini Siena',category:'Carteras',description:'Compacta y encantadora, con un diseño fácil de combinar y el tamaño perfecto para llevar tus esenciales.',price:1490,image:'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=700&q=80',badge:'Nuevo'},
  {id:'serena',name:'Lentes Serena',category:'Accesorios',description:'Lentes de sol con detalles dorados y acabado carey para darle un toque sofisticado a cualquier salida.',price:790,image:'https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=700&q=80',badge:'Esencial'},
  {id:'fiesta',name:'Bolso Fiesta',category:'Accesorios',description:'Un bolso pequeño en rosa suave para llevar lo esencial con un toque especial en tus celebraciones.',price:1250,image:'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?auto=format&fit=crop&w=700&q=80',badge:'Nuevo'}
];
const cookieName='gr_session';
const secret=()=>process.env.SESSION_SECRET||'';
const json=(statusCode,body,headers={})=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers},body:JSON.stringify(body)});
const hash=(password,salt)=>crypto.scryptSync(password,salt,64).toString('hex');
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const sign=value=>crypto.createHmac('sha256',secret()).update(value).digest('base64url');
function cookie(event){return(event.headers.cookie||event.headers.Cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
function sessionToken(payload){const data=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${data}.${sign(data)}`}
function validSession(event,admin){if(!secret())return false;try{const [data,signature]=cookie(event).split('.');if(!equal(signature,sign(data)))return false;const p=JSON.parse(Buffer.from(data,'base64url').toString());return p.user===admin.username&&p.rev===admin.rev&&p.exp>Date.now()}catch{return false}}
function setCookie(value,maxAge=28800){return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Secure`}
async function readAdmin(){if(secret().length<32)throw new Error('Configura SESSION_SECRET (mínimo 32 caracteres) en Netlify.');let admin=await store().get('admin',{type:'json'});if(admin)return admin;const username=process.env.ADMIN_USER||'',password=process.env.ADMIN_PASSWORD||'';if(!username||password.length<12)throw new Error('Configura ADMIN_USER y una ADMIN_PASSWORD de al menos 12 caracteres en Netlify.');const salt=crypto.randomBytes(16).toString('hex');admin={username,salt,hash:hash(password,salt),rev:crypto.randomUUID()};
  await store().setJSON('admin',admin);return admin}
async function readProducts(){return await store().get('catalog',{type:'json'})||seed}
async function writeProducts(items){await store().setJSON('catalog',items)}
function parsePath(event){let p=event.path||'/';const marker='/.netlify/functions/api';if(p.includes(marker))p=p.slice(p.indexOf(marker)+marker.length)||'/';if(p.startsWith('/api'))p=p.slice(4)||'/';return p}
async function requestBody(event){try{return JSON.parse(event.body||'{}')}catch{throw new Error('Los datos enviados no son válidos.')}}
async function cleanProduct(input,old={}){const name=String(input.name||'').trim(),description=String(input.description||'').trim(),category=String(input.category||'').trim(),price=Number(input.price);if(!name||!description||!category||!Number.isFinite(price)||price<=0)throw new Error('Completa nombre, descripción, categoría y un precio válido.');let image=old.image||'';
 if(input.imageData){const found=String(input.imageData).match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);if(!found)throw new Error('Usa una imagen JPG, PNG o WEBP.');const ext=found[1]==='jpeg'?'jpg':found[1],bytes=Buffer.from(found[2],'base64');if(bytes.length>4*1024*1024)throw new Error('La imagen debe pesar menos de 4 MB.');const file=`${crypto.randomUUID()}.${ext}`;await store().set(`image:${file}`,bytes,{metadata:{contentType:`image/${ext==='jpg'?'jpeg':ext}`}});image=`/uploads/${file}`}
 else if(input.imageUrl?.trim())image=input.imageUrl.trim();if(!image)throw new Error('Añade una foto o un enlace de imagen.');return{...old,id:old.id||crypto.randomUUID(),name,description,category,price,image,badge:String(input.badge||'').trim()}}

export default async (event) => {
  try {
    const method=event.httpMethod||'GET',path=parsePath(event);
    if(path.startsWith('/uploads/')){const file=path.slice('/uploads/'.length);if(!/^[\w-]+\.(jpg|jpeg|png|webp)$/i.test(file))return{statusCode:404,body:'No se encontró la imagen.'};const item=await store().getWithMetadata(`image:${file}`,{type:'arrayBuffer'});if(!item?.data)return{statusCode:404,body:'No se encontró la imagen.'};return{statusCode:200,headers:{'Content-Type':item.metadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'},body:Buffer.from(item.data).toString('base64'),isBase64Encoded:true}}
    if(method==='GET'&&path==='/products')return json(200,await readProducts());
    const admin=await readAdmin();
    if(method==='POST'&&path==='/login'){
      const input=await requestBody(event);if(String(input.username||'')!==admin.username||!equal(hash(String(input.password||''),admin.salt),admin.hash))return json(401,{error:'Usuario o contraseña incorrectos.'});
      return json(200,{ok:true,username:admin.username},{'Set-Cookie':setCookie(sessionToken({user:admin.username,rev:admin.rev,exp:Date.now()+8*60*60*1000}))});
    }
    if(method==='POST'&&path==='/logout')return json(200,{ok:true},{'Set-Cookie':setCookie('',0)});
    if(path.startsWith('/admin/')&&!validSession(event,admin))return json(401,{error:'Inicia sesión para continuar.'});
    if(method==='GET'&&path==='/admin/session')return json(200,{ok:true,username:admin.username});
    if(method==='POST'&&path==='/admin/products') {const items=await readProducts(),item=await cleanProduct(await requestBody(event));items.unshift(item);await writeProducts(items);return json(201,item)}
    const match=path.match(/^\/admin\/products\/([\w-]+)$/);
    if(match&&method==='PUT'){const items=await readProducts(),i=items.findIndex(x=>x.id===match[1]);if(i<0)return json(404,{error:'No encontramos ese producto.'});items[i]=await cleanProduct(await requestBody(event),items[i]);await writeProducts(items);return json(200,items[i])}
    if(match&&method==='DELETE'){const items=await readProducts(),next=items.filter(x=>x.id!==match[1]);if(next.length===items.length)return json(404,{error:'No encontramos ese producto.'});await writeProducts(next);return json(200,{ok:true})}
    if(method==='POST'&&path==='/admin/password'){
      const input=await requestBody(event);if(!equal(hash(String(input.currentPassword||''),admin.salt),admin.hash))return json(401,{error:'La contraseña actual no coincide.'});if(String(input.newPassword||'').length<12)return json(400,{error:'La nueva contraseña debe tener al menos 12 caracteres.'});admin.salt=crypto.randomBytes(16).toString('hex');admin.hash=hash(String(input.newPassword),admin.salt);admin.rev=crypto.randomUUID();await store().setJSON('admin',admin);return json(200,{ok:true},{'Set-Cookie':setCookie('',0)})
    }
    return json(404,{error:'No encontramos esa acción.'});
  } catch(error) { console.error(error);return json(500,{error:error.message||'No se pudo completar la solicitud.'}) }
};
