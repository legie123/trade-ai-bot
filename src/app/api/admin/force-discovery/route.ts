import { NextResponse } from 'next/server';
import { generateAndDeployNewStrategy } from '@/lib/engine/discoveryLLM';

export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await generateAndDeployNewStrategy();
  return NextResponse.json(res);
}
