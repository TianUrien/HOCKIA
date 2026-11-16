import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useCommonT } from '@/i18n/ns/common'

export interface BreadcrumbItem {
  label: string
  to?: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

export default function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  const t = useCommonT()
  if (items.length === 0) return null

  return (
    <nav aria-label={t('breadcrumbs.label')} className={`flex items-center gap-1.5 text-sm ${className}`}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1

        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
            {isLast || !item.to ? (
              <span className="text-gray-500 truncate max-w-[200px]">{item.label}</span>
            ) : (
              <Link
                to={item.to}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                {item.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
