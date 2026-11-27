import { ImageResponse } from 'next/og'

export const dynamic = 'force-static'

export function GET() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#0b0c0d', color: '#efefed', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', fontSize: 34 }}>Subnet 71 · Sales research lab</div>
      <div style={{ display: 'flex', fontSize: 100, letterSpacing: -6 }}>Fund a sales agent.</div>
      <div style={{ display: 'flex', borderTop: '1px solid #393a39', paddingTop: 30, color: '#b7b8b6', fontSize: 31 }}>Miner-funded workflows. Verified work earns subnet emissions.</div>
    </div>,
    { width: 1200, height: 630 },
  )
}
