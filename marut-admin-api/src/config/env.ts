import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV                 : z.enum(['development', 'test', 'production']).default('development'),
  PORT                     : z.coerce.number().int().positive().default(4000),
  FRONTEND_URL             : z.string().url(),
  SUPABASE_URL             : z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY        : z.string().min(1),
});

export const env = schema.parse(process.env);
