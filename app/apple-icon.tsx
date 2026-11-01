import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '180px',
          height: '180px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F4ECD8',
          padding: '14px',
        }}
      >
        <div
          style={{
            width: '146px',
            height: '146px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F2545B',
            border: '10px solid #111111',
            borderRadius: '34px',
            boxShadow: '10px 10px 0px #111111',
            position: 'relative',
          }}
        >
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '96px',
              fontWeight: 900,
              color: '#FFFDF7',
              lineHeight: 1,
            }}
          >
            B
          </span>
          <div
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              width: '24px',
              height: '24px',
              borderRadius: '8px',
              backgroundColor: '#FFE74C',
              border: '4px solid #111111',
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
