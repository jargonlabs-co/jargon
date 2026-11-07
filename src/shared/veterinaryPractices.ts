/** Veterinary practices on the account, with the hours a Google Business profile lists. */

export type VeterinaryPractice = {
  id: string
  name: string
  title: string
  company: string
  email: string
  phone: string
  city: string
  timezone: string
  /** Posted weekday hours, as the profile lists them. */
  hours: string
  /** Quiet stretch inside those hours, HH:MM in the practice's zone. */
  startLocal: string
  endLocal: string
  reason: string
}

export const VETERINARY_PRACTICES: VeterinaryPractice[] = [
  {
    id: 'prac_riverside',
    name: 'Lena Cho',
    title: 'Practice Owner',
    company: 'Riverside Animal Hospital',
    email: 'lena.cho@riversideanimalhospital.com',
    phone: '+15125550148',
    city: 'Austin, TX',
    timezone: 'America/Chicago',
    hours: '7:00am–6:00pm',
    startLocal: '07:00',
    endLocal: '07:45',
    reason: 'Google Business hours 7:00am–6:00pm. Opens at 7:00am, before the 8:00 surgery block.'
  },
  {
    id: 'prac_pine',
    name: 'Marcus Hale',
    title: 'Hospital Administrator',
    company: 'Pine Street Veterinary',
    email: 'marcus.hale@pinestreetveterinary.com',
    phone: '+13125550162',
    city: 'Chicago, IL',
    timezone: 'America/Chicago',
    hours: '8:00am–6:00pm',
    startLocal: '11:30',
    endLocal: '13:00',
    reason: 'Google Business hours 8:00am–6:00pm. The front desk is between appointments over lunch.'
  },
  {
    id: 'prac_harbor',
    name: 'Alicia Grant',
    title: 'Practice Manager',
    company: 'Harbor View Pet Clinic',
    email: 'alicia.grant@harborviewpetclinic.com',
    phone: '+16175550177',
    city: 'Boston, MA',
    timezone: 'America/New_York',
    hours: '8:00am–5:30pm',
    startLocal: '11:30',
    endLocal: '13:00',
    reason: 'Google Business hours 8:00am–5:30pm. Lunch is the quiet stretch on the profile.'
  },
  {
    id: 'prac_summit',
    name: 'Owen Briggs',
    title: 'Medical Director',
    company: 'Summit Veterinary',
    email: 'owen.briggs@summitveterinary.com',
    phone: '+13035550183',
    city: 'Denver, CO',
    timezone: 'America/Denver',
    hours: '7:30am–6:00pm',
    startLocal: '07:30',
    endLocal: '08:15',
    reason: 'Google Business hours 7:30am–6:00pm. Opens at 7:30am, and the first appointments are at 8:30.'
  },
  {
    id: 'prac_westside',
    name: 'Priya Shah',
    title: 'Owner',
    company: 'Westside Animal Care',
    email: 'priya.shah@westsideanimalcare.com',
    phone: '+13105550194',
    city: 'Los Angeles, CA',
    timezone: 'America/Los_Angeles',
    hours: '9:00am–7:00pm',
    startLocal: '12:00',
    endLocal: '13:30',
    reason: 'Google Business hours 9:00am–7:00pm. The desk is free from noon to 1:30pm.'
  },
  {
    id: 'prac_cascade',
    name: 'Noah Patel',
    title: 'Hospital Manager',
    company: 'Cascade Veterinary',
    email: 'noah.patel@cascadeveterinary.com',
    phone: '+12065550206',
    city: 'Seattle, WA',
    timezone: 'America/Los_Angeles',
    hours: '8:00am–10:00pm',
    startLocal: '18:00',
    endLocal: '19:00',
    reason: 'Google Business hours 8:00am–10:00pm. Evening visits pick up after 7:00pm.'
  },
  {
    id: 'prac_magnolia',
    name: 'Elena Voss',
    title: 'Practice Owner',
    company: 'Magnolia Pet Hospital',
    email: 'elena.voss@magnoliapethospital.com',
    phone: '+14045550218',
    city: 'Atlanta, GA',
    timezone: 'America/New_York',
    hours: '7:00am–6:00pm',
    startLocal: '07:00',
    endLocal: '07:40',
    reason: 'Google Business hours 7:00am–6:00pm. Opens at 7:00am, before the morning surgeries.'
  },
  {
    id: 'prac_redrock',
    name: 'Chris Dalton',
    title: 'Office Manager',
    company: 'Red Rock Animal Clinic',
    email: 'chris.dalton@redrockanimalclinic.com',
    phone: '+16025550224',
    city: 'Phoenix, AZ',
    timezone: 'America/Phoenix',
    hours: '8:00am–5:00pm',
    startLocal: '11:30',
    endLocal: '12:30',
    reason: 'Google Business hours 8:00am–5:00pm. Call during the midday break.'
  },
  {
    id: 'prac_lakeshore',
    name: 'Hannah Brooks',
    title: 'Practice Manager',
    company: 'Lakeshore Veterinary',
    email: 'hannah.brooks@lakeshoreveterinary.com',
    phone: '+16125550231',
    city: 'Minneapolis, MN',
    timezone: 'America/Chicago',
    hours: '8:30am–5:30pm',
    startLocal: '16:00',
    endLocal: '17:00',
    reason: 'Google Business hours 8:30am–5:30pm. The last appointments start at 4:00pm.'
  },
  {
    id: 'prac_mission',
    name: 'Ben Okonkwo',
    title: 'Medical Director',
    company: 'Mission Bay Animal Hospital',
    email: 'ben.okonkwo@missionbayanimalhospital.com',
    phone: '+14155550247',
    city: 'San Francisco, CA',
    timezone: 'America/Los_Angeles',
    hours: '8:00am–6:00pm',
    startLocal: '08:00',
    endLocal: '08:45',
    reason: 'Google Business hours 8:00am–6:00pm. Opens at 8:00am. Surgeries start at 9:00.'
  }
]

export function practiceContext(practice: VeterinaryPractice): string[] {
  return [`Google Business hours: ${practice.hours}`, practice.reason]
}

export function practiceByCompany(company: string): VeterinaryPractice | undefined {
  const needle = normalizePractice(company)
  if (!needle) return undefined
  return VETERINARY_PRACTICES.find((practice) => {
    const name = normalizePractice(practice.company)
    return name === needle || name.includes(needle) || needle.includes(name)
  })
}

function normalizePractice(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
