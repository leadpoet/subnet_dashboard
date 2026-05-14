import type { Metadata } from 'next'
import { NewRequestBuilder } from './_components/NewRequestBuilder'

export const metadata: Metadata = {
  title: 'New request · Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function NewRequestPage() {
  return <NewRequestBuilder />
}
