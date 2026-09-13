import { AdminMetagraph } from './_components/AdminMetagraph'
import { AdminResearchLab } from './_components/AdminResearchLab'
import { AdminWeightsAlerts } from './_components/AdminWeightsAlerts'

export const dynamic = 'force-dynamic'

export default function AdminLandingPage() {
  return (
    <div className="space-y-6">
      <AdminWeightsAlerts />
      <AdminResearchLab />
      <AdminMetagraph />
    </div>
  )
}
