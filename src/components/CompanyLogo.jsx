import { useState } from 'react'

const SIZES = { sm: 24, md: 32, lg: 48 }

export default function CompanyLogo({ logoUrl, companyName, size = 'md' }) {
  const [imgError, setImgError] = useState(false)
  const px = SIZES[size] || SIZES.md
  const letter = (companyName || '?')[0].toUpperCase()

  if (logoUrl && !imgError) {
    return (
      <img
        src={logoUrl}
        alt={companyName}
        onError={() => setImgError(true)}
        style={{
          width: px, height: px, borderRadius: 6, objectFit: 'contain',
          border: '1px solid #e1e4e8', background: '#fff', flexShrink: 0,
        }}
      />
    )
  }

  return (
    <div style={{
      width: px, height: px, borderRadius: 6, background: '#f5f5f5',
      border: '1px solid #e1e4e8', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: px * 0.45, fontWeight: 700,
      color: '#666666', flexShrink: 0,
    }}>
      {letter}
    </div>
  )
}
