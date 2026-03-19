/**
 * AdminVacancyDetail Page
 * 
 * Detailed view of a single vacancy with applicants list.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDate } from '../utils/formatDate'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  RefreshCw,
  Building2,
  MapPin,
  Calendar,
  Clock,
  Users,
  Star,
  XCircle,
  HelpCircle,
  Inbox,
  AlertTriangle,
  Video,
  ExternalLink,
} from 'lucide-react'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { getVacancyDetail, getVacancyApplicants } from '../api/adminApi'
import type { VacancyDetail, VacancyApplicant, ApplicationStatus } from '../types'
import { logger } from '@/lib/logger'

export function AdminOpportunityDetail() {
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<VacancyDetail | null>(null)
  const [applicants, setApplicants] = useState<VacancyApplicant[]>([])
  const [totalApplicants, setTotalApplicants] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchData = useCallback(async () => {
    if (!id) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const [detailData, applicantsData] = await Promise.all([
        getVacancyDetail(id),
        getVacancyApplicants(
          id,
          statusFilter === 'all' ? undefined : statusFilter,
          pageSize,
          page * pageSize
        ),
      ])
      
      setDetail(detailData)
      setApplicants(applicantsData.applicants)
      setTotalApplicants(applicantsData.totalCount)
    } catch (err) {
      logger.error('[AdminVacancyDetail] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load vacancy details')
    } finally {
      setIsLoading(false)
    }
  }, [id, statusFilter, page])

  useEffect(() => {
    document.title = 'Vacancy Detail | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const formatTimeToFirstApp = (minutes: number | null): string => {
    if (!minutes) return '—'
    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`
    return `${Math.round(minutes / 1440)}d`
  }

  const statusLabels: Record<ApplicationStatus, string> = {
    pending: 'Unsorted',
    shortlisted: 'Good fit',
    maybe: 'Maybe',
    rejected: 'Not a fit',
  }

  const statusStyles: Record<ApplicationStatus, string> = {
    pending: 'bg-gray-100 text-gray-700',
    shortlisted: 'bg-emerald-100 text-emerald-700',
    maybe: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-700',
  }

  const applicantColumns: Column<VacancyApplicant>[] = [
    {
      key: 'player_name',
      label: 'Applicant',
      render: (_, row) => (
        <div className="flex items-center gap-3">
          {row.avatar_url ? (
            <img
              src={row.avatar_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <Users className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900">{row.player_name || 'Unknown'}</p>
            <p className="text-xs text-gray-500">{row.player_email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'nationality',
      label: 'Nationality',
      render: (value) => (
        <span className="text-sm text-gray-600">{String(value) || '—'}</span>
      ),
    },
    {
      key: 'position',
      label: 'Position',
      render: (value) => (
        <span className="text-sm text-gray-600 capitalize">{String(value) || '—'}</span>
      ),
    },
    {
      key: 'highlight_video_url',
      label: 'Video',
      render: (value) =>
        value ? (
          <a
            href={String(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 hover:text-purple-700"
            title="Watch highlight video"
            aria-label="Watch highlight video"
          >
            <Video className="w-4 h-4" />
          </a>
        ) : (
          <span className="text-gray-300">—</span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value) => (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusStyles[value as ApplicationStatus]}`}>
          {statusLabels[value as ApplicationStatus] ?? String(value)}
        </span>
      ),
    },
    {
      key: 'applied_at',
      label: 'Applied',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {formatAdminDate(String(value))}
        </span>
      ),
    },
    {
      key: 'player_id',
      label: '',
      render: (_, row) => (
        <Link
          to={`/admin/directory?id=${row.player_id}`}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors inline-flex"
        >
          <ExternalLink className="w-4 h-4 text-gray-400" />
        </Link>
      ),
    },
  ]

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load vacancy</h2>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (isLoading && !detail) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Vacancy not found</p>
        <Link to="/admin/opportunities" className="text-purple-600 hover:text-purple-700 mt-2 inline-block">
          Back to opportunities
        </Link>
      </div>
    )
  }

  const { vacancy, club, stats } = detail

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            to="/admin/opportunities"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Opportunities
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{vacancy.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${
              vacancy.status === 'open' ? 'bg-green-100 text-green-700' :
              vacancy.status === 'closed' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {vacancy.status}
            </span>
            <span className="text-sm text-gray-500">•</span>
            <span className="text-sm text-gray-500 capitalize">{vacancy.opportunity_type}</span>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vacancy Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Details</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Building2 className="w-4 h-4 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-900">{club.full_name}</p>
                <p className="text-xs text-gray-500">{club.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {vacancy.location_city}, {vacancy.location_country}
              </span>
            </div>
            {vacancy.position && (
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600 capitalize">{vacancy.position}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                Posted {formatAdminDate(vacancy.created_at)}
              </span>
            </div>
            {vacancy.application_deadline && (
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  Deadline: {formatAdminDate(vacancy.application_deadline)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Application Statistics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{stats.total_applications}</p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
            <div className="text-center p-3 bg-emerald-50 rounded-lg">
              <p className="text-2xl font-bold text-emerald-600">{stats.shortlisted}</p>
              <p className="text-xs text-gray-500">Good fit</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <p className="text-2xl font-bold text-amber-600">{stats.maybe}</p>
              <p className="text-xs text-gray-500">Maybe</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
              <p className="text-xs text-gray-500">Not a fit</p>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {stats.first_application_at
                  ? formatAdminDate(stats.first_application_at)
                  : '—'}
              </p>
              <p className="text-xs text-gray-500">First Application</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {formatTimeToFirstApp(
                  stats.first_application_at && vacancy.published_at
                    ? Math.round((new Date(stats.first_application_at).getTime() - new Date(vacancy.published_at).getTime()) / 60000)
                    : null
                )}
              </p>
              <p className="text-xs text-gray-500">Time to First App</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{stats.avg_apps_per_day ?? '—'}</p>
              <p className="text-xs text-gray-500">Avg Apps/Day</p>
            </div>
          </div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Status Breakdown</h2>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50">
            <Inbox className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Unsorted</span>
            <span className="text-sm font-bold text-gray-600">{stats.pending}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50">
            <Star className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-gray-700">Good fit</span>
            <span className="text-sm font-bold text-emerald-600">{stats.shortlisted}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50">
            <HelpCircle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-gray-700">Maybe</span>
            <span className="text-sm font-bold text-amber-600">{stats.maybe}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium text-gray-700">Not a fit</span>
            <span className="text-sm font-bold text-red-600">{stats.rejected}</span>
          </div>
        </div>
      </div>

      {/* Applicants Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Applicants ({totalApplicants})
          </h2>
          <select
            aria-label="Filter applicants by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as ApplicationStatus | 'all')
              setPage(0)
            }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="all">All statuses</option>
            <option value="pending">Unsorted</option>
            <option value="shortlisted">Good fit</option>
            <option value="maybe">Maybe</option>
            <option value="rejected">Not a fit</option>
          </select>
        </div>
        
        <DataTable
          data={applicants}
          columns={applicantColumns}
          keyField="application_id"
          loading={isLoading}
          emptyMessage="No applicants found"
        />
        
        {/* Pagination */}
        {totalApplicants > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalApplicants)} of {totalApplicants}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * pageSize >= totalApplicants}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
