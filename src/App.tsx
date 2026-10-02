import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './context'
import { configured } from './lib/supabase'
import { Button, Notice, Spinner } from './components/ui'
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })))
const Shell = lazy(() => import('./components/Shell').then(m => ({ default: m.Shell })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const PropertiesPage = lazy(() => import('./pages/PropertiesPage').then(m => ({ default: m.PropertiesPage })))
const PropertyPage = lazy(() => import('./pages/PropertyPage').then(m => ({ default: m.PropertyPage })))
const EditorPage = lazy(() => import('./pages/EditorPage').then(m => ({ default: m.EditorPage })))
const TourPage = lazy(() => import('./pages/TourPage').then(m => ({ default: m.TourPage })))
const PublishPage = lazy(() => import('./pages/PublishPage').then(m => ({ default: m.PublishPage })))
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const OrganizationPage = lazy(() => import('./pages/OrganizationPage').then(m => ({ default: m.OrganizationPage })))
function PrivateRoutes() {
  const { session, organization, organizationError, refreshOrganizations, loading } = useApp()
  const location = useLocation()
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (organizationError) return <div className="mx-auto mt-24 max-w-xl space-y-4 px-4"><Notice>Could not load your workspace: {organizationError}</Notice><Button onClick={() => { void refreshOrganizations().catch(() => {}) }}>Try again</Button></div>
  if (organization && location.pathname === '/setup') return <Navigate to="/dashboard" replace />
  if (!organization && location.pathname !== '/setup') return <Navigate to="/setup" replace />
  return <Routes><Route path="/setup" element={<OrganizationPage />} /><Route element={<Shell />}><Route path="/dashboard" element={<DashboardPage />} /><Route path="/properties" element={<PropertiesPage />} /><Route path="/properties/new" element={<PropertyPage />} /><Route path="/properties/:id" element={<PropertyPage />} /><Route path="/properties/:id/editor" element={<EditorPage />} /><Route path="/properties/:id/preview" element={<TourPage preview />} /><Route path="/properties/:id/publish" element={<PublishPage />} /><Route path="/billing" element={<BillingPage />} /><Route path="/settings" element={<SettingsPage />} /></Route><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes>
}
function RoutedApp() { const location = useLocation(); if (!configured) return <div className="mx-auto mt-24 max-w-xl px-4"><Notice kind="info">{import.meta.env.PROD ? <>This deployment was built without valid Supabase settings. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the hosting build environment, then build and deploy again.</> : <>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in <code>.env.local</code>, then restart the development server. See README.md for setup.</>}</Notice></div>; if (location.pathname.startsWith('/tour/')) return <Routes><Route path="/tour/:slug" element={<TourPage />} /></Routes>; if (location.pathname === '/login') return <AuthPage />; return <PrivateRoutes /> }
export function App() { return <AppProvider><Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner /></div>}><RoutedApp /></Suspense></AppProvider> }
