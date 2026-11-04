import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QrCode({ value, size = 220, label }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#14231a', light: '#f1ead9' } })
      .then(setSrc).catch(() => setSrc(''));
  }, [value, size]);
  return (
    <div className="cm-qr">
      {src ? <img src={src} width={size} height={size} alt={label || 'QR code'} /> : <div style={{ width: size, height: size }} />}
      {label && <div className="fs-footnote">{label}</div>}
    </div>
  );
}
