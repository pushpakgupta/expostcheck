// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import GDPRWebhookHandlers from "./gdpr.js";

import cors from "cors";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";


const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const OFFERS = [
  {
    id: 8382467440934,
    title: "One time offer",
    productTitle: "Selling Plans Ski Wax",
    productImageURL:
      "https://jalr6lulxwpv1e3u-77764362534.shopifypreview.com/cdn/shop/products/snowboard_wax.png?v=1687412938&width=1100", // Replace this with product image's URL.
    productDescription: ["Experience smooth, effortless skiing with Selling Plans Ski Wax. This wax is made with soap, ensuring a slippery surface that can combat wet snow and hard-packed ice. Ready to use right out of the container, the wax helps skiers move quickly and smoothly over the terrain."],
    originalPrice: "24.95",
    discountedPrice: "21.21",
    changes: [
      {
        type: "add_variant",
        variantID: 45314310996262, // Replace with the variant ID.
        quantity: 1,
        discount: {
          value: 15,
          valueType: "percentage",
          title: "15% off",
        },
      },
    ],
  },
];
/*
 * For testing purposes, product information is hardcoded.
 * In a production application, replace this function with logic to determine
 * what product to offer to the customer.
 */
function getOffers() {
  return OFFERS;
}
/*
 * Retrieve discount information for the specific order on the backend instead of relying
 * on the discount information that is sent from the frontend.
 * This is to ensure that the discount information is not tampered with.
 */
function getSelectedOffer(offerId) {
  return OFFERS.find((offer) => offer.id === offerId);
}

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers })
);



app.use(express.json());

/*
 * You don't have an active session from Shopify App Bridge, so you need to define this route before the
 * session validation middleware.
 * Add cors middleware to allow the request to come from Shopify checkout.
 */
app.post("/api/offer", cors(), async (req, res) => {
  try {
    // JWT verify will throw an error if this token doesn't have a valid signature. For more information, refer to
    // https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback
    jwt.verify(req.body.token, 'c7fafa4d318408ecfb7b47dc4fc64315');
  } catch (e) {
    res.status(401).send("Unauthorized");
  }

  const payload = getOffers();
  res.json(JSON.stringify({offers: payload}));
});

/*
* The extension will call this route with information about how the order should be changed.
* You will create a JWT token that is signed with the app's API secret key.
* The extension will call Shopify with the token to update the order.
*/
app.post("/api/sign-changeset", cors(), async (req, res) => {
  try {
    jwt.verify(req.body.token, 'c7fafa4d318408ecfb7b47dc4fc64315');
  } catch (e) {
    res.status(401).send("Unauthorized");
  }

  const selectedOffer = getSelectedOffer(req.body.changes);

  const payload = {
    iss: '6ee8fd0f32435ac5476dc45e49f18744',
    jti: uuidv4(),
    iat: Date.now(),
    sub: req.body.referenceId,
    changes: selectedOffer.changes,
  };

  const token = jwt.sign(payload, 'c7fafa4d318408ecfb7b47dc4fc64315');
  res.status(200).send(JSON.stringify({token}));
});

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use("/api/*", shopify.validateAuthenticatedSession());


app.get("/api/products/count", async (_req, res) => {
  const countData = await shopify.api.rest.Product.count({
    session: res.locals.shopify.session,
  });
  res.status(200).send(countData);
});

app.get("/api/products/create", async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    console.log(`Failed to process products/create: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT);
