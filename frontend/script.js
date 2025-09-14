// Front-End Script for MES Simulation
// Uses MQTT.js to connect to internal broker, handle button events, update UI

// MQTT Configuration
const MQTT_OPTIONS = {
  hostname: 'localhost',
  port: 9001,
  protocol: 'ws',
  username: 'mes_user',
  password: 'mes_pass',
  path: '/mqtt'
};

// Topics
const TOPICS = {
  mesProcessStart: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/ProcessOrder/Start',
  mesProcessNext: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/ProcessOrder/NextStep',
  mesLabelPrint: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/HandlingUnit/Print',
  mesLabelScan: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/HandlingUnit/Scan',
  mesProcessFinish: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/ProcessOrder/Finish',
  mesStagingRequest: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/Staging/Request',
  mesStagingConfirm: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/Staging/Confirm',
  masterDataRequest: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/MasterData/Request',
  subStatus: 'ACME/China/Pinghu/Area1/WorkCenter1/MES/#',  // Wildcard for updates
  subMaster: 'ACME/China/Pinghu/Area1/MasterData/#'
};

// Global Variables
let client;
let currentOrder = null;

// Initialize MQTT Client
function connectMQTT() {
  client = mqtt.connect(MQTT_OPTIONS);

  client.on('connect', function () {
    console.log('Connected to MQTT broker');
    document.getElementById('mqtt-status').textContent = 'Connected';
    document.getElementById('mqtt-status').style.color = 'green';

    // Subscribe to status and master data topics
    client.subscribe(TOPICS.subStatus, {qos: 1});
    client.subscribe(TOPICS.subMaster, {qos: 1});

    loadMasterData();
  });

  client.on('message', function (topic, message) {
    const payload = JSON.parse(message.toString());
    handleMessage(topic, payload);
  });

  client.on('error', function (err) {
    console.error('MQTT error', err);
    document.getElementById('mqtt-status').textContent = 'Error';
    document.getElementById('mqtt-status').style.color = 'red';
  });
}

// Handle Incoming Messages
function handleMessage(topic, payload) {
  const logContainer = document.getElementById('log-container');
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  logEntry.textContent = `[${new Date().toISOString()}] Topic: ${topic}, Payload: ${JSON.stringify(payload)}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // Update UI based on topic
  if (topic.includes('ProcessOrder/Status')) {
    currentOrder = payload.orderNumber;
    updateStatus(payload.status || payload);
  } else if (topic.includes('MasterData')) {
    updateMasterData(payload);
  } else if (topic.includes('Staging/Status')) {
    updateStagingStatus(payload);
  }
}

// Update Process Order Status
function updateStatus(status) {
  const section = document.getElementById('process-order');
  const statusDiv = document.createElement('div');
  statusDiv.id = 'status-display';
  statusDiv.textContent = `Current Status: ${status}`;
  statusDiv.style.color = 'var(--green3)';
  section.appendChild(statusDiv);
}

// Update Master Data (populate selects)
function updateMasterData(data) {
  if (data.type === 'materials') {
    const materialSelect = document.getElementById('material');
    materialSelect.innerHTML = '<option value="">Select Material</option>';
    data.materials.forEach(mat => {
      const option = document.createElement('option');
      option.value = mat.code;
      option.textContent = mat.description;
      materialSelect.appendChild(option);
    });
  }
}

// Update Staging Status
function updateStagingStatus(status) {
  // Similar to updateStatus, add to UI
  console.log('Staging Status:', status);
}

// Load Master Data on Startup
function loadMasterData() {
  const payload = { action: 'load', type: 'all' };
  client.publish(TOPICS.masterDataRequest, JSON.stringify(payload), {qos: 1});
}

// Button Event Listeners
document.addEventListener('DOMContentLoaded', function () {
  connectMQTT();

  // Start Order
  document.getElementById('start-order').addEventListener('click', function () {
    const orderNumber = document.getElementById('order-number').value;
    const quantity = document.getElementById('quantity').value;
    const material = document.getElementById('material').value;

    if (!orderNumber || !quantity || !material) {
      alert('Please fill all fields');
      return;
    }

    const payload = {
      orderNumber,
      quantity: parseFloat(quantity),
      material,
      action: 'start'
    };

    client.publish(TOPICS.mesProcessStart, JSON.stringify(payload), {qos: 1});
    document.getElementById('start-order').disabled = true;
    addLog('Started process order: ' + orderNumber);
  });

  // Next Step
  document.getElementById('next-step').addEventListener('click', function () {
    if (!currentOrder) {
      alert('Start an order first');
      return;
    }
    const payload = { orderNumber: currentOrder, action: 'next' };
    client.publish(TOPICS.mesProcessNext, JSON.stringify(payload), {qos: 1});
    addLog('Next step for order: ' + currentOrder);
  });

  // Print Label
  document.getElementById('print-label').addEventListener('click', function () {
    const huNumber = document.getElementById('hu-number').value;
    if (!huNumber) {
      alert('Enter HU Number');
      return;
    }
    const payload = { huNumber, action: 'print' };
    client.publish(TOPICS.mesLabelPrint, JSON.stringify(payload), {qos: 1});
    addLog('Printed label for HU: ' + huNumber);
  });

  // Scan Label
  document.getElementById('scan-label').addEventListener('click', function () {
    const scanCode = document.getElementById('scan-code').value;
    if (!scanCode) {
      alert('Scan a code');
      return;
    }
    const payload = { scannedSSCC: scanCode, action: 'scan' };
    client.publish(TOPICS.mesLabelScan, JSON.stringify(payload), {qos: 1});
    addLog('Scanned label: ' + scanCode);
  });

  // Finish Order
  document.getElementById('finish-order').addEventListener('click', function () {
    if (!currentOrder) {
      alert('Start an order first');
      return;
    }
    const producedQty = document.getElementById('produced-qty').value;
    const payload = { orderNumber: currentOrder, producedQty: parseFloat(producedQty) || 0, action: 'finish' };
    client.publish(TOPICS.mesProcessFinish, JSON.stringify(payload), {qos: 1});
    addLog('Finished order: ' + currentOrder);
  });

  // Request Staging
  document.getElementById('request-staging').addEventListener('click', function () {
    const material = document.getElementById('staging-material').value;
    const location = document.getElementById('storage-loc').value;
    const qty = document.getElementById('staging-qty').value;
    if (!material || !location || !qty) {
      alert('Fill all fields');
      return;
    }
    const payload = { material, storageLocation: location, quantity: parseFloat(qty), action: 'request' };
    client.publish(TOPICS.mesStagingRequest, JSON.stringify(payload), {qos: 1});
    addLog('Requested staging for: ' + material);
  });

  // Confirm Delivery
  document.getElementById('confirm-delivery').addEventListener('click', function () {
    const requestId = document.getElementById('request-id').value;
    if (!requestId) {
      alert('Enter Request ID');
      return;
    }
    const payload = { requestId, action: 'confirm' };
    client.publish(TOPICS.mesStagingConfirm, JSON.stringify(payload), {qos: 1});
    addLog('Confirmed delivery for: ' + requestId);
  });

  // Load Master Data
  document.getElementById('load-master').addEventListener('click', function () {
    loadMasterData();
  });
});

// Helper to add log
function addLog(message) {
  const logContainer = document.getElementById('log-container');
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
}