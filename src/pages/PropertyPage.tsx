import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Box, PencilRuler, Save, Trash2 } from 'lucide-react'
import { useApp } from '../context'
import { deleteProperty, getLatestJob, getLatestModel, getProperty, queueModelJob, saveProperty } from '../lib/data'
import { errorMessage } from '../lib/supabase'
import type { ProcessingJob, PropertyModel, PropertyStatus } from '../lib/types'
import { Button, Card, Field, Input, Notice, PageHeader, Spinner, Textarea } from '../components/ui'

const statuses: PropertyStatus[] = ['draft', 'active', 'under_offer', 'sold', 'let']
const initial = { title: '', address: '', description: '', property_type: 'House', bedrooms: 0,
  bathrooms: 0, status: 'draft' as PropertyStatus, layout_width_m: 12 }

export function PropertyPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { organization } = useApp()
  const [form, setForm] = useState(initial)
  const [loading, setLoading] = useState(Boolean(id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [job, setJob] = useState<ProcessingJob | null>(null)
  const [model, setModel] = useState<PropertyModel | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([getProperty(id), getLatestJob(id), getLatestModel(id)]).then(([property, currentJob, currentModel]) => {
      setForm({ title: property.title, address: property.address, description: property.description,
        property_type: property.property_type, bedrooms: property.bedrooms, bathrooms: property.bathrooms,
        status: property.status, layout_width_m: property.layout_width_m || 12 })
      setJob(currentJob); setModel(currentModel)
    }).catch(e => setError(errorMessage(e))).finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!id || !job || !['queued', 'processing'].includes(job.status)) return
    const timer = window.setInterval(() => {
      Promise.all([getLatestJob(id), getLatestModel(id)]).then(([nextJob, nextModel]) => {
        setJob(nextJob); setModel(nextModel)
      }).catch(e => setError(errorMessage(e)))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [id, job])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!organization) return
    setBusy(true); setError(''); setSaved(false)
    try {
      const property = await saveProperty({ ...form, organization_id: organization.id, id })
      setSaved(true)
      if (!id) navigate(`/properties/${property.id}`, { replace: true })
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const generate = async () => {
    if (!id || !organization) return
    setBusy(true); setError('')
    try {
      await saveProperty({ ...form, organization_id: organization.id, id })
      await queueModelJob(id)
      setJob(await getLatestJob(id))
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!id || !window.confirm('Delete this property and all its rooms, photos, and tour? This cannot be undone.')) return
    setBusy(true)
    try {
      const failures = await deleteProperty(id)
      if (failures.length) window.alert('Property deleted, but some files could not be removed from Storage. Contact support to finish cleanup.')
      navigate('/properties')
    } catch (e) { setError(errorMessage(e)); setBusy(false) }
  }

  return <>
    <Link to="/properties" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-pine"><ArrowLeft size={17}/>All properties</Link>
    <PageHeader eyebrow={id ? 'Property details' : 'New listing'} title={id ? 'Edit property' : 'Create property'}
      description="Start with the essentials. Build your levels, spaces, and imagery next."
      action={id && <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to={`/properties/${id}/editor`}><PencilRuler size={16}/>Layout composer</Link></Button><Button variant="outline" asChild><Link to={`/properties/${id}/preview`}>Preview tour</Link></Button></div>} />
    {loading ? <Spinner /> : <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <Card><form onSubmit={submit} className="space-y-6"><div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Property title"><Input required maxLength={120} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></Field></div>
        <div className="sm:col-span-2"><Field label="Address"><Input required maxLength={250} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></Field></div>
        <div className="sm:col-span-2"><Field label="Description"><Textarea maxLength={5000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field></div>
        <Field label="Property type"><select className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={form.property_type} onChange={e => setForm({ ...form, property_type: e.target.value })}>{['House', 'Apartment', 'Townhouse', 'Villa', 'Studio', 'Commercial', 'Land', 'Other'].map(value => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Listing status"><select className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as PropertyStatus })}>{statuses.map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></Field>
        <Field label="Bedrooms"><Input type="number" min="0" max="100" required value={form.bedrooms} onChange={e => setForm({ ...form, bedrooms: Number(e.target.value) })}/></Field>
        <Field label="Bathrooms"><Input type="number" min="0" max="100" required value={form.bathrooms} onChange={e => setForm({ ...form, bathrooms: Number(e.target.value) })}/></Field>
        <Field label="Approximate plan width (metres)" hint="Sets the scale of all levels in the 3D model."><Input type="number" min="2" max="100" step="0.1" required value={form.layout_width_m} onChange={e => setForm({ ...form, layout_width_m: Number(e.target.value) })}/></Field>
      </div>{error && <Notice>{error}</Notice>}{saved && <Notice kind="success">Property saved.</Notice>}
      <div className="flex justify-between border-t border-line pt-6"><Button type="submit" disabled={busy}><Save size={16}/>{busy ? 'Saving…' : 'Save property'}</Button>{id && <Button type="button" variant="danger" onClick={remove} disabled={busy}><Trash2 size={16}/>Delete</Button>}</div>
      </form></Card>
      <div className="space-y-4">
        <Card><p className="text-xs font-bold uppercase tracking-widest text-pine">Next step</p><h2 className="mt-2 font-extrabold">Build the experience</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">Map spaces across levels and add photographs.</p>{id && <Button asChild className="mt-5 w-full"><Link to={`/properties/${id}/editor`}>Open editor</Link></Button>}</Card>
        {id && <Card><p className="text-xs font-bold uppercase tracking-widest text-pine">3D model</p><h2 className="mt-2 font-extrabold">Generate from your layout</h2><p className="mt-2 text-sm text-slate-500">Draw at least one room area first. The model uses your room shapes and keeps their photos linked.</p>
          {job && <div className="mt-4 rounded-xl bg-cream p-3 text-sm"><strong>{job.status[0].toUpperCase() + job.status.slice(1)}</strong> · {job.progress}%{job.error_message && <p className="mt-2 text-red-700">{job.error_message}</p>}</div>}
          {model && <p className="mt-3 text-xs text-slate-500">Latest model: version {model.version}</p>}
          <Button className="mt-5 w-full" onClick={generate} disabled={busy || job?.status === 'queued' || job?.status === 'processing'}><Box size={16}/>{model ? 'Rebuild 3D model' : 'Generate 3D model'}</Button>
          {model && <Button asChild variant="outline" className="mt-2 w-full"><Link to={`/properties/${id}/preview`}>View in tour</Link></Button>}
        </Card>}
        {id && <Card><p className="text-xs font-bold uppercase tracking-widest text-pine">Go live</p><h2 className="mt-2 font-extrabold">Share your tour</h2><p className="mt-2 text-sm text-slate-500">Preview and publish when the details look right.</p><Button asChild variant="outline" className="mt-5 w-full"><Link to={`/properties/${id}/publish`}>Publish settings</Link></Button></Card>}
      </div>
    </div>}
  </>
}
