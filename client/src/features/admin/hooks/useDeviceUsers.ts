import { useQuery } from '@tanstack/react-query'
import { getDeviceUsers } from '../api/adminApi'
import type { DevicePlatformFilter, DeviceUsersResult } from '../types'

interface UseDeviceUsersArgs {
  platform: DevicePlatformFilter
  search: string
  limit: number
  offset: number
}

export function useDeviceUsers({ platform, search, limit, offset }: UseDeviceUsersArgs) {
  return useQuery<DeviceUsersResult>({
    queryKey: ['admin', 'device-users', platform, search, limit, offset],
    queryFn: () => getDeviceUsers({ platform, search, limit, offset }),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  })
}
