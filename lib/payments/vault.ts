import {PaymentError} from './errors';
import {Keypair} from '@solana/web3.js';
function bytes(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
function base64(value:Uint8Array){return btoa(String.fromCharCode(...value))}
async function key(secret:string){const raw=bytes(secret);if(raw.byteLength!==32)throw new PaymentError('The wallet vault key must contain 32 random bytes.');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function encryptWallet(wallet:Keypair,secret:string,identity:string){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(identity)},await key(secret),Uint8Array.from(wallet.secretKey));return JSON.stringify({v:1,iv:base64(iv),data:base64(new Uint8Array(encrypted))})}
export async function decryptWallet(ciphertext:string,secret:string,identity:string){const c=JSON.parse(ciphertext);if(c.v!==1)throw new PaymentError('Unsupported wallet encryption version.');const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(c.iv),additionalData:new TextEncoder().encode(identity)},await key(secret),bytes(c.data));return Keypair.fromSecretKey(new Uint8Array(raw))}
