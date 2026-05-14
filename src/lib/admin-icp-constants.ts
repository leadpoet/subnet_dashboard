/**
 * Authoritative value sets for fulfillment ICP submission. These mirror
 * the gateway's Pydantic validators (see message-(16).txt rules file in
 * the project root). The gateway will 422 on anything outside these sets,
 * so the admin form uses these to constrain inputs and pre-validate.
 *
 * Industries / sub-industries are NOT enumerated here because the live
 * taxonomy is sourced from `gateway/utils/industry_taxonomy.py` which we
 * cannot import. They render as free-text in the form and the gateway's
 * 422 response is surfaced to the operator if anything is invalid.
 */

export const VALID_ROLE_TYPES = [
  'Business Development',
  'C-Level Executive',
  'Consulting',
  'Customer Success',
  'Data & Analytics',
  'Design',
  'Director',
  'Engineering',
  'Finance',
  'HR',
  'IT',
  'Legal',
  'Manager',
  'Marketing',
  'Operations',
  'Other',
  'Product',
  'Research',
  'Sales',
  'Supply Chain',
  'VP',
] as const

export type RoleType = (typeof VALID_ROLE_TYPES)[number]

export const EMPLOYEE_COUNT_BUCKETS = [
  '0-1',
  '2-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1,000',
  '1,001-5,000',
  '5,001-10,000',
  '10,001+',
] as const

export type EmployeeBucket = (typeof EMPLOYEE_COUNT_BUCKETS)[number]

/**
 * Common seed list of country names. Not exhaustive — operators can type
 * any country. We use this list for parsing free-form ICP text.
 */
export const COMMON_COUNTRIES: string[] = [
  'United States',
  'Canada',
  'Mexico',
  'United Kingdom',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Switzerland',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
  'Ireland',
  'Australia',
  'New Zealand',
  'Japan',
  'South Korea',
  'Singapore',
  'India',
  'Brazil',
  'Argentina',
  'Chile',
  'Colombia',
  'Peru',
  'Uruguay',
  'Paraguay',
  'Ecuador',
  'Bolivia',
  'Venezuela',
  'Guyana',
  'Suriname',
]

/**
 * Valid industry values returned by the gateway validator. Keep this list
 * synced with gateway/utils/industry_taxonomy.py::VALID_INDUSTRIES. We use
 * it to prevent the AI parser from inventing labels like "Technology" or
 * "PropTech" that the gateway rejects.
 */
export const VALID_INDUSTRIES = [
  'Administrative Services',
  'Advertising',
  'Agriculture and Farming',
  'Apps',
  'Artificial Intelligence',
  'Biotechnology',
  'Blockchain and Cryptocurrency',
  'Clothing and Apparel',
  'Collaboration',
  'Commerce and Shopping',
  'Community and Lifestyle',
  'Consumer Electronics',
  'Consumer Goods',
  'Content and Publishing',
  'Data and Analytics',
  'Design',
  'Education',
  'Energy',
  'Events',
  'Financial Services',
  'Food and Beverage',
  'Gaming',
  'Government and Military',
  'Hardware',
  'Health Care',
  'Information Technology',
  'Internet Services',
  'Lending and Investments',
  'Manufacturing',
  'Media and Entertainment',
  'Messaging and Telecommunications',
  'Mobile',
  'Music and Audio',
  'Natural Resources',
  'Navigation and Mapping',
  'Payments',
  'Physical Infrastructure',
  'Platforms',
  'Privacy and Security',
  'Professional Services',
  'Real Estate',
  'Sales and Marketing',
  'Science and Engineering',
  'Social Impact',
  'Software',
  'Sports',
  'Sustainability',
  'Transportation',
  'Travel and Tourism',
  'Video',
] as const

export type Industry = (typeof VALID_INDUSTRIES)[number]

export const COMMON_INDUSTRIES: string[] = [...VALID_INDUSTRIES]

const INDUSTRY_ALIAS_MAP: Record<string, Industry[]> = {
  technology: ['Information Technology', 'Software', 'Data and Analytics', 'Internet Services', 'Platforms'],
  tech: ['Information Technology', 'Software', 'Data and Analytics', 'Internet Services', 'Platforms'],
  proptech: ['Real Estate', 'Software', 'Data and Analytics', 'Information Technology'],
  'property technology': ['Real Estate', 'Software', 'Data and Analytics', 'Information Technology'],
  'real estate technology': ['Real Estate', 'Software', 'Data and Analytics', 'Information Technology'],
  'property data': ['Real Estate', 'Data and Analytics', 'Information Technology', 'Software'],
  fintech: ['Financial Services', 'Payments', 'Lending and Investments', 'Information Technology', 'Software'],
  cybersecurity: ['Privacy and Security', 'Information Technology', 'Software'],
  telecom: ['Messaging and Telecommunications'],
  telecommunications: ['Messaging and Telecommunications'],
  marketing: ['Sales and Marketing'],
  advertising: ['Advertising', 'Sales and Marketing'],
  retail: ['Commerce and Shopping', 'Consumer Goods'],
  ecommerce: ['Commerce and Shopping'],
  'e-commerce': ['Commerce and Shopping'],
  nonprofit: ['Social Impact'],
  'non-profit': ['Social Impact'],
  government: ['Government and Military'],
  logistics: ['Transportation'],
}

const VALID_INDUSTRY_SET = new Set<string>(VALID_INDUSTRIES)

export function normalizeIndustries(values: string[]): Industry[] {
  const out: Industry[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue

    const exact = VALID_INDUSTRIES.find((industry) => industry.toLowerCase() === value.toLowerCase())
    if (exact && !out.includes(exact)) {
      out.push(exact)
      continue
    }

    const aliases = INDUSTRY_ALIAS_MAP[value.toLowerCase()]
    if (aliases) {
      for (const alias of aliases) {
        if (VALID_INDUSTRY_SET.has(alias) && !out.includes(alias)) out.push(alias)
      }
    }
  }
  return out
}

const COMMON_INVALID_SUB_INDUSTRIES = new Set([
  'proptech',
  'property technology',
  'real estate technology',
  'property data',
  'technology',
  'tech',
  'fintech',
])

export function sanitizeSubIndustries(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !COMMON_INVALID_SUB_INDUSTRIES.has(value.toLowerCase()))
}
