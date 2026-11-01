import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F4ECD8',
          padding: '1px',
        }}
      >
        <div
          style={{
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F2545B',
            border: '3px solid #111111',
            borderRadius: '7px',
            boxShadow: '2px 2px 0px #111111',
            position: 'relative',
          }}
        >
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '19px',
              fontWeight: 900,
              color: '#FFFDF7',
              lineHeight: 1,
              marginTop: '1px',
            }}
          >
            B
          </span>
          <div
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              width: '5px',
              height: '5px',
              borderRadius: '2px',
              backgroundColor: '#FFE74C',
              border: '1px solid #111111',
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
