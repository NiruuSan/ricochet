import {notFound} from 'next/navigation';
import Arena from '../ricochet';
export default async function Page({params}:{params:Promise<{view:string}>}){const {view}=await params;if(!['welcome','matches','leaderboard','wallet','login','signup','faq','rules','admin'].includes(view))notFound();return <Arena view={view}/>}
