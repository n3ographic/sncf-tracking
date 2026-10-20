// Types partagés entre l'Edge Function (Deno) et les scripts Node. TS pur, sans import.
export type Brand = 'INOUI' | 'OUIGO'
export type Axis = 'NORD' | 'SUD_EST' | 'ATLANTIQUE' | 'EST' | 'INTERSECTEURS'

// stopDelays : stop_sequence (en chaîne) -> retard en secondes, ou 'cancelled'.
export interface TripSnapshot {
  serviceDate: string
  tripId: string
  cancelled: boolean
  stopDelays: Record<string, number | 'cancelled'>
  alertIds: string[]
}

export type EventKind = 'first_seen' | 'delay' | 'stop_cancelled' | 'cancelled' | 'uncancelled' | 'alert_added' | 'alert_removed'

export interface EventRow {
  observed_at: string
  service_date: string
  trip_id: string
  kind: EventKind
  stop_sequence: number | null
  value: Record<string, unknown>
}

// arrPlanned : stop_sequence -> heure ISO.
export interface PlannedStopTimes { serviceDate: string; tripId: string; arrPlanned: Record<string, string> }

// Équivaut à ReturnType<typeof transit_realtime.FeedMessage.toObject> (protobufjs type toObject
// en { [k: string]: any }) ; écrit en dur pour ne pas importer gtfs-realtime-bindings côté Deno.
export type DecodedFeed = { [k: string]: any }

// Une interface par table de la migration 20261020000001_schema.sql.
export interface StopRow { stop_id: string; name: string; lat: number | null; lon: number | null }

export interface TripPlannedRow {
  service_date: string
  trip_id: string
  brand: Brand
  train_number: string
  axis: Axis
  origin_stop_id: string | null
  dest_stop_id: string | null
  dep_planned: string | null
  arr_planned: string | null
}

export interface StopTimePlannedRow {
  service_date: string
  trip_id: string
  stop_sequence: number
  stop_id: string | null
  arr_planned: string | null
  dep_planned: string | null
}
