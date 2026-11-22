import express                      from 'express';
import cors                         from 'cors';
import helmet                       from 'helmet';
import { env }                      from './config/env.js';
import { authRouter }               from './modules/auth/auth.routes.js';
import { usersRouter }              from './modules/users/users.routes.js';
import { acceptInviteRouter }       from './modules/users/accept-invite.routes.js';
import { HttpError }                from './utils/http.js';
import { metaRouter }               from './modules/meta.routes.js';
import { verticalsRouter }          from './modules/verticals/verticals.routes.js';
import { categoriesRouter }         from './modules/products/categories.routes.js';
import { productsRouter }           from './modules/products/products.routes.js';
import { packSizesRouter }          from './modules/products/pack-sizes.router.js';
import { productImagesRouter }      from './modules/products/product-images.routes.js';
import { minimumPriceFloorsRouter } from './modules/products/minimum-floor-price.js';
import { globalPriceFloorsRouter }  from './modules/products/minimum-floor-price.js';
import { pricingRouter }            from './modules/products/pricing.routes.js';


export const app = express();
const helmetMiddleware = (
  helmet as unknown as () => express.RequestHandler
)();

app.use(helmetMiddleware);
app.use(cors({ 
    origin     : env.FRONTEND_URL, 
    credentials: false 
}));
app.use(express.json({ 
    limit: '1mb' 
}));


app.get('/health'                                         , (_req, res) => res.json({ status: 'ok', service: 'marut-admin-api' }));
app.use('/api/v1/auth'                                    , authRouter);
app.use('/api/v1/users'                                   , usersRouter);
app.use('/api/v1/invitations'                             , acceptInviteRouter);
app.use('/api/v1/meta'                                    , metaRouter);
app.use('/api/v1/verticals'                               , verticalsRouter);
app.use('/api/v1/products/categories'                     , categoriesRouter);
app.use('/api/v1/products'                                , productsRouter);
app.use('/api/v1/products/:productId/pack-sizes'          , packSizesRouter);
app.use('/api/v1/products/:productId/images'              , productImagesRouter);
app.use('/api/v1/products/:productId/minimum-price-floors', minimumPriceFloorsRouter);
app.use('/api/v1/pricing/global-minimum-floors'           , globalPriceFloorsRouter);
app.use('/api/v1/products/:productId/prices'              , pricingRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ 
        error: { 
            code   : err.code, 
            message: err.message 
            } 
        });
    }
  if (err && typeof err === 'object' && 'issues' in err) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: (err as {issues: unknown}).issues } });
  }
  console.error(err);
  return res.status(500).json({ 
        error: { 
                code   : 'INTERNAL_ERROR', 
                message: 'An unexpected error occurred.' 
        } 
    });
});
export default app;