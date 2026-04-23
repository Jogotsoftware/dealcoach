import React from 'react'
import ReactDOM from 'react-dom/client'
import posthog from 'posthog-js'
import * as Sentry from '@sentry/react'
import App from './App'
import './styles/index.css'

// Sentry — no-op if VITE_SENTRY_DSN is unset
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  })
}

// PostHog — no-op if VITE_POSTHOG_KEY is unset
if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
