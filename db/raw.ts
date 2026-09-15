import {env} from 'cloudflare:workers';
export function database(){if(!env.DB)throw Error('Demo accounts are temporarily unavailable. Practice is still available.');return env.DB}
export function adminId(){return (env as unknown as Record<string,string>).RICOCHET_ADMIN_USER_ID}
