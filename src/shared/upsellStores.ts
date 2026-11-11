/** Open upsell stores on the account, with the last Attention call and the add-on that fits the brand. */

export type UpsellStore = {
  id: string
  name: string
  title: string
  company: string
  email: string
  phone: string
  city: string
  attentionPain: string
  brandAddon: string
  quietWindow: string
}

export const UPSELL_STORES: UpsellStore[] = [
  {
    id: 'store_northline',
    name: 'Elena Voss',
    title: 'Retail director',
    company: 'Northline',
    email: 'elena.voss@northline.com',
    phone: '+13125550141',
    city: 'Chicago',
    attentionPain: 'The floor already has too many tools, and another login will not get used.',
    brandAddon: 'Replenishment inside the brand’s existing ordering app',
    quietWindow: '10:00–11:30am CT'
  },
  {
    id: 'store_harbor',
    name: 'Chris Adeyemi',
    title: 'Store operations',
    company: 'Harbor Supply',
    email: 'chris.adeyemi@harborsupply.com',
    phone: '+16175550158',
    city: 'Boston',
    attentionPain: 'Budget is parked until the spring set is in, and they do not want a second vendor.',
    brandAddon: 'A seasonal set that rides the brand’s current fixture',
    quietWindow: '9:00–10:30am ET'
  },
  {
    id: 'store_lumen',
    name: 'Maya Chen',
    title: 'Brand manager',
    company: 'Lumen Goods',
    email: 'maya.chen@lumengoods.com',
    phone: '+15125550173',
    city: 'Austin',
    attentionPain: 'They already run loyalty in-house and will not add a competing program.',
    brandAddon: 'Loyalty that uses the brand’s own list',
    quietWindow: '8:00–9:30am CT'
  }
]
