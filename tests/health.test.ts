import { describe, expect, it } from 'vitest'
import { collectorProblem, runWarning } from '../supabase/functions/_shared/health.ts'

describe('runWarning', () => {
  it('rien à signaler en régime normal', () => {
    expect(runWarning({ tgvEntities: 400, matched: 380, plannedToday: 544 })).toBeNull()
  })
  it('des TGV dans le flux mais aucun rapproché du plan', () => {
    expect(runWarning({ tgvEntities: 400, matched: 0, plannedToday: 544 })).toMatch(/aucun.*plan/)
  })
  it('flux sans TGV (nuit) : pas d’alerte sur le rapprochement', () => {
    expect(runWarning({ tgvEntities: 0, matched: 0, plannedToday: 544 })).toBeNull()
  })
  it('plan du jour vide', () => {
    expect(runWarning({ tgvEntities: 0, matched: 0, plannedToday: 0 })).toMatch(/trips_planned/)
  })
})

describe('collectorProblem', () => {
  const now = new Date('2026-10-20T21:10:00Z')
  it('ok si passage récent et sans erreur', () => {
    expect(collectorProblem({ last_run_at: '2026-10-20T21:08:00Z', last_error: null }, now)).toBeNull()
  })
  it('dernier passage trop ancien', () => {
    expect(collectorProblem({ last_run_at: '2026-10-20T20:59:00Z', last_error: null }, now)).toMatch(/min/)
  })
  it('jamais passé', () => {
    expect(collectorProblem(null, now)).not.toBeNull()
  })
  it('erreur enregistrée', () => {
    expect(collectorProblem({ last_run_at: '2026-10-20T21:08:00Z', last_error: 'flux : HTTP 503' }, now)).toMatch(/503/)
  })
})
