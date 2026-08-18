// Server Component - data is fetched on the server for instant page loads
import { headers } from 'next/headers'
import { getInitialPageData } from '@/lib/server-data'
import { DashboardClient } from '@/components/dashboard'
import { isSubnet71PublicRequest } from '@/lib/dashboard-tabs'

// Force dynamic rendering to always show fresh data
export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  // Fetch aggregated data server-side (no raw data caching!)
  const { dashboardData, metagraph } = await getInitialPageData()
  const requestHeaders = await headers()
  const isSubnet71Public = isSubnet71PublicRequest(
    requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-host'),
  )

  // Pass pre-fetched data to client component
  return (
    <DashboardClient
      initialData={dashboardData}
      metagraph={metagraph}
      isSubnet71Public={isSubnet71Public}
    />
  )
}
