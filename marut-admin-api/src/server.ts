import { app } from './app.js';
import { env } from './config/env.js';


app.listen(env.PORT, () => console.log(`MARUT Admin API listening on port ${env.PORT}`));
