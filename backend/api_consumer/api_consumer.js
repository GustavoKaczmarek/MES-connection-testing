require('dotenv').config();
const mqtt = require('mqtt');
const axios = require('axios');
const sql = require('mssql');
const NodeCache = require('node-cache');

const SAP_BASE_URL = process.env.SAP_BASE_URL;
const TOKEN_URL = process.env.SAP_OAUTH_TOKEN_URL;
const CLIENT_ID = process.env.SAP_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.SAP_OAUTH_CLIENT_SECRET;
const SCOPE = 'sap.read';

const MQTT_HOST = 'localhost';
const MQTT_PORT = 1883;
const MQTT_USER = 'mes_user';
const MQTT_PASS = 'mes_pass';

const SUB_TOPIC = 'ACME/China/Pinghu/Area1/Internal/TriggerAPI/#';

const DB_CONFIG = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    min: parseInt(process.env.DB_POOL_MIN || '0'),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000')
  },
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const tokenCache = new NodeCache({ stdTTL: 3000 });

let dbPool;

async function connectDB() {
  try {
    dbPool = await sql.connect(DB_CONFIG);
    console.log('DB connected');
  } catch (err) {
    console.error('DB connection failed', err);
    setTimeout(connectDB, 5000);
  }
}

async function getToken() {
  let token = tokenCache.get('sap_token');
  if (token) return token;

  try {
    const response = await axios.post(TOKEN_URL, new URLSearchParams({
      grant_type: 'client_credentials',
      scope: SCOPE
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
      }
    });

    token = response.data.access_token;
    tokenCache.set('sap_token', token, 3000);
    return token;
  } catch (err) {
    console.error('Token fetch failed', err);
    throw err;
  }
}

async function makeAPICall(endpoint, params, retries = 3) {
  let token = await getToken();
  let lastError;

  for (let i = 0; i < retries; i++) {
    try {
      const url = `${SAP_BASE_URL}${endpoint}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        params
      });

      return { success: true, data: response.data, status: response.status };
    } catch (err) {
      lastError = err;
      if (err.response && err.response.status === 401) {
        tokenCache.del('sap_token');
        token = await getToken();
      }
      if (i === retries - 1) throw lastError;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

async function logToDB(endpoint, params, responseData, statusCode, errorMessage = null) {
  if (!dbPool) return;
  try {
    const request = new sql.Request();
    await request.query(`
      INSERT INTO ApiResponsesLog (endpoint, method, request_params, response_data, status_code, error_message, created_at)
      VALUES (@endpoint, @method, @request_params, @response_data, @status_code, @error_message, GETDATE())
    `, {
      endpoint: { type: sql.VarChar(500), value: endpoint },
      method: { type: sql.VarChar(10), value: 'GET' },
      request_params: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(params) },
      response_data: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(responseData) },
      status_code: { type: sql.Int, value: statusCode },
      error_message: { type: sql.VarChar(1000), value: errorMessage }
    });
  } catch (err) {
    console.error('DB log failed', err);
  }
}

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  username: MQTT_USER,
  password: MQTT_PASS,
  reconnectPeriod: 1000
});

mqttClient.on('connect', () => {
  console.log('MQTT connected');
  mqttClient.subscribe(SUB_TOPIC, (err) => {
    if (err) {
      console.error('Subscribe failed', err);
    } else {
      console.log(`Subscribed to ${SUB_TOPIC}`);
    }
  });
});

mqttClient.on('message', async (topic, message) => {
  let payload, endpoint, params;
  try {
    payload = JSON.parse(message.toString());
    endpoint = payload.endpoint;
    params = payload.params || {};

    const orderId = params.orderId || 'unknown';
    const successTopic = `ACME/China/Pinghu/Area1/SAP Workcenters/ProcessOrder/${orderId}`;

    console.log(`Received on ${topic}:`, payload);

    const apiResult = await makeAPICall(endpoint, params);

    await logToDB(endpoint, params, apiResult.data, apiResult.status);
    mqttClient.publish(successTopic, JSON.stringify({
      request: payload,
      response: apiResult.data,
      status: 'success'
    }));

  } catch (err) {
    console.error('Message processing error', err);
    const errorPayload = { error: err.message, code: err.response?.status || 500 };
    mqttClient.publish('/Internal/Errors/api', JSON.stringify(errorPayload));
    if (endpoint && params) {
      await logToDB(endpoint, params, null, err.response?.status || 500, err.message);
    }
  }
});

mqttClient.on('error', (err) => {
  console.error('MQTT error', err);
});

mqttClient.on('reconnect', () => {
  console.log('MQTT reconnecting');
});

mqttClient.on('close', () => {
  console.log('MQTT connection closed');
});

connectDB();

process.on('SIGINT', async () => {
  if (dbPool) await sql.close();
  mqttClient.end(() => {
    process.exit(0);
  });
});