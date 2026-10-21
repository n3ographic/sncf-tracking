import { createLiveHandler } from '../../../lib/handlers';
import { supabaseDeps } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const GET = createLiveHandler(supabaseDeps);
