import {launchStatus} from '@/lib/payments/policy';
import {settings} from '@/lib/payments/service';
export const dynamic='force-dynamic';
export function GET(){return Response.json(launchStatus(settings()),{headers:{'Cache-Control':'no-store'}})}
