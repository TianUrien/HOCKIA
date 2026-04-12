/**
 * AdminDeviceUsers Page
 *
 * Drill-down for the Devices cards on AdminOverview.
 * Lists users filtered by platform (ios | android | desktop | pwa | multi).
 */

import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Search, Copy, Check, Smartphone, Monitor, Globe } from 'lucide-react'
import { DataTable } from '../components'
import type { Column } from '../components'
import { useDeviceUsers } from '../hooks/useDeviceUsers'
import { formatAdminDate, formatAdminDateTime } from '../utils/formatDate'
import type { DevicePlatformFilter, DeviceUser } from '../types'

const PAGE_SIZE = 50

const PLATFORM_CONFIG: Record<string, { label: string; color: string }> = {
  ios:     { label: 'iOS',       color: 'bg-blue-50 text-blue-700 border-blue-200' },
  android: { label: 'Android',   color: 'bg-green-50 text-green-700 border-green-200' },
  desktop: { label: 'Desktop',   color: 'bg-purple-50 text-purple-700 border-purple-200' },
  pwa:     { label: 'PWA',       color: 'bg-amber-50 text-amber-700 border-amber-200' },
  multi:   { label: 'Multi-Platform', color: 'bg-rose-50 text-rose-700 border-rose-200' },
}

function parsePlatform(raw: string | undefined): DevicePlatformFilter {
  if (!raw) return null
  if (raw === 'ios' || raw === 'android' || raw === 'desktop' || raw === 'pwa' || raw === 'multi') {
    return raw
  }
  return null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function PlatformBadges({ devices }: { devices: DeviceUser['devices'] }) {
  if (!devices || devices.length === 0) return <span className="text-xs text-gray-400">—</span>
  const unique = new Map<string, boolean>()
  for (const d of devices) {
    const key = d.platform
    unique.set(key, unique.get(key) || d.is_pwa)
  }
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from(unique.entries()).map(([platform, isPwa]) => {
        const cfg = PLATFORM_CONFIG[platform] ?? { label: platform, color: 'bg-gray-50 text-gray-700 border-gray-200' }
        return (
          <span
            key={platform}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border ${cfg.color}`}
          >
            {platform === 'desktop' ? <Monitor className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
            {cfg.label}
            {isPwa && <span className="opacity-70">(PWA)</span>}
          </span>
        )
      })}
    </div>
  )
}

export function AdminDeviceUsers() {
  const { platform: platformParam } = useParams<{ platform?: string }>()
  const platform = parsePlatform(platformParam)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const offset = (page - 1) * PAGE_SIZE

  const { data, isLoading, isFetching, error, refetch } = useDeviceUsers({
    platform,
    search,
    limit: PAGE_SIZE,
    offset,
  })

  const heading = useMemo(() => {
    if (!platform) return 'All Device Users'
    return `${PLATFORM_CONFIG[platform]?.label ?? platform} Users`
  }, [platform])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const columns: Column<DeviceUser>[] = [
    {
      key: 'full_name',
      label: 'User',
      render: (_v, row) => (
        <div className="flex items-center gap-3 min-w-0">
          {row.avatar_url ? (
            <img src={row.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-xs text-gray-500">
              {(row.full_name || row.email || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">
              {row.full_name || <span className="text-gray-400 italic">No name</span>}
            </div>
            {row.username && <div className="text-xs text-gray-500 truncate">@{row.username}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      render: (_v, row) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-gray-700 truncate">{row.email || '—'}</span>
          {row.email && <CopyButton text={row.email} />}
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (_v, row) => (
        <span className="text-xs text-gray-700 capitalize">{row.role || '—'}</span>
      ),
    },
    {
      key: 'devices',
      label: 'Platforms',
      render: (_v, row) => <PlatformBadges devices={row.devices} />,
    },
    {
      key: 'id',
      label: 'User ID',
      render: (_v, row) => (
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono text-gray-500">{row.id.slice(0, 8)}…</span>
          <CopyButton text={row.id} />
        </div>
      ),
    },
    {
      key: 'signup_date',
      label: 'Signed Up',
      render: (_v, row) => (
        <span className="text-xs text-gray-600">{row.signup_date ? formatAdminDate(row.signup_date) : '—'}</span>
      ),
    },
    {
      key: 'last_seen_at',
      label: 'Last Active',
      render: (_v, row) => (
        <span className="text-xs text-gray-600">
          {row.last_seen_at ? formatAdminDateTime(row.last_seen_at) : '—'}
        </span>
      ),
    },
  ]

  const rows = data?.results ?? []
  const total = data?.total ?? 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/admin/overview"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Overview
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total.toLocaleString()} {total === 1 ? 'user' : 'users'}
            {platform === 'multi' && ' using 2+ platforms'}
            {platform === 'pwa' && ' installed as PWA'}
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, email, or username"
              className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 w-72"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setSearch('')
                setPage(1)
              }}
              className="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Platform tabs for quick filter switching */}
      <div className="flex flex-wrap gap-2">
        {(['ios', 'android', 'desktop', 'pwa', 'multi'] as const).map((p) => {
          const cfg = PLATFORM_CONFIG[p]
          const active = platform === p
          return (
            <Link
              key={p}
              to={`/admin/devices/${p}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition ${
                active
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {p === 'desktop' ? <Monitor className="w-3.5 h-3.5" /> : p === 'multi' ? <Globe className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
              {cfg.label}
            </Link>
          )
        })}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{error instanceof Error ? error.message : String(error)}</p>
          <button onClick={() => refetch()} className="text-sm text-red-700 underline">
            Retry
          </button>
        </div>
      )}

      <DataTable<DeviceUser>
        data={rows}
        columns={columns}
        keyField="id"
        loading={isLoading || isFetching}
        emptyMessage="No users match the current filters."
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalCount: total,
          onPageChange: setPage,
        }}
      />
    </div>
  )
}
