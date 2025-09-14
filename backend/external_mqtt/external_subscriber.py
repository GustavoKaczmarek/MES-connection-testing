import paho.mqtt.client as mqtt
import json
import yaml
import os
import pyodbc
from urllib.parse import urlparse, parse_qs

def load_config(config_path):
    """Load YAML config and substitute environment variables."""
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    def substitute_env(obj):
        if isinstance(obj, dict):
            return {k: substitute_env(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [substitute_env(item) for item in obj]
        elif isinstance(obj, str):
            import re
            def replacer(match):
                var = match.group(1).split(':-')[0]
                default = match.group(1).split(':-')[1] if ':-' in match.group(1) else ''
                return os.environ.get(var, default)
            return re.sub(r'\$\{([^}]+)\}', replacer, obj)
        else:
            return obj
    
    return substitute_env(config)

def build_pyodbc_connection_string(config):
    """Build pyodbc connection string from SQLAlchemy-style URL."""
    conn_url = config['db']['connection_string']
    parsed = urlparse(conn_url)
    query = parse_qs(parsed.query)
    
    driver = query.get('driver', ['ODBC Driver 17 for SQL Server'])[0]
    trust_cert = query.get('trustcert', ['no'])[0] == 'yes'
    
    server = f"{parsed.hostname}:{parsed.port}" if parsed.port else parsed.hostname
    database = parsed.path.lstrip('/')
    username = parsed.username
    password = parsed.password
    
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={username};"
        f"PWD={password};"
    )
    if trust_cert:
        conn_str += "TrustServerCertificate=yes;"
    
    return conn_str

def log_mqtt_message(conn_str, topic, payload, broker, status):
    """Log to MqttMessagesLog."""
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO MqttMessagesLog (topic, payload, broker, status) VALUES (?, ?, ?, ?)",
            topic, json.dumps(payload), broker, status
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB log error for MQTT message: {e}")

def log_event(conn_str, event_type, payload, status="Received"):
    """Log to EventsLog."""
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO EventsLog (event_type, payload, status, location) VALUES (?, ?, ?, ?)",
            event_type, json.dumps(payload), status, "External MQTT"
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB log error for event: {e}")

def on_connect_external(client, userdata, flags, rc):
    """Subscribe to topics on connect."""
    if rc == 0:
        config = userdata['config']
        topics = config['external_broker']['topics']
        for topic in topics:
            client.subscribe(topic)
        print(f"Subscribed to external topics: {topics}")
    else:
        print(f"External connect failed with code {rc}")

def on_message(client, userdata, msg):
    """Handle incoming messages."""
    config = userdata['config']
    conn_str = userdata['conn_str']
    internal_client = userdata['internal_client']
    
    try:
        payload = json.loads(msg.payload.decode('utf-8'))
        topic = msg.topic
        
        # Log received
        log_mqtt_message(conn_str, topic, payload, "External", "Received")
        
        event_type = payload.get("event")
        if not event_type:
            log_mqtt_message(conn_str, topic, payload, "External", "Error: No event type")
            return
        
        # Log event
        log_event(conn_str, event_type, payload)
        
        # Handle specific events
        if event_type == "ProcessOrderCreate":
            order_number = payload.get("orderNumber")
            material_code = payload.get("materialCode")
            
            if not order_number:
                error_msg = {"original_payload": payload, "error": "Missing orderNumber"}
                log_mqtt_message(conn_str, topic, error_msg, "External", "Error: Invalid payload")
                log_event(conn_str, event_type, error_msg, "Error")
                return
            
            # Prepare trigger payload
            trigger_topic = f"{config['internal_broker']['trigger_topic_base']}processorder"
            trigger_payload = {
                "action": "getProcessOrder",
                "params": {"orderId": order_number},
                "endpoint": f"/processorders/{order_number}"
            }
            
            # Publish to internal
            result = internal_client.publish(trigger_topic, json.dumps(trigger_payload))
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                log_mqtt_message(conn_str, trigger_topic, trigger_payload, "Internal", "Published")
                print(f"Triggered process order {order_number}")
            else:
                print(f"Failed to publish trigger: {result.rc}")
        
        # Add handlers for other events as needed
        # elif event_type == "MaterialCreate":
        #     ...
        
    except json.JSONDecodeError as e:
        error_msg = {"topic": topic, "raw_payload": msg.payload.decode('utf-8'), "error": str(e)}
        log_mqtt_message(conn_str, topic, error_msg, "External", "Error: Invalid JSON")
    except Exception as e:
        error_msg = {"topic": topic, "payload": payload, "error": str(e)}
        log_mqtt_message(conn_str, topic, error_msg, "External", "Error")

def on_disconnect_external(client, userdata, rc):
    """Handle disconnect."""
    if rc != 0:
        print("Unexpected external disconnect, attempting reconnect")

def main():
    config_path = "backend/external_mqtt/config.yaml"
    config = load_config(config_path)
    conn_str = build_pyodbc_connection_string(config)
    
    # Internal publisher client
    internal_config = config['internal_broker']
    internal_client = mqtt.Client()
    internal_client.username_pw_set(internal_config['username'], internal_config['password'])
    internal_client.connect(internal_config['host'], internal_config['port'], 60)
    internal_client.loop_start()
    
    # External subscriber client
    external_config = config['external_broker']
    external_client = mqtt.Client(transport='websockets')
    external_client.username_pw_set(external_config['username'], external_config['password'])
    external_client.tls_set()  # Enable TLS for wss
    
    external_client.on_connect = on_connect_external
    external_client.on_message = on_message
    external_client.on_disconnect = on_disconnect_external
    
    userdata = {
        'config': config,
        'conn_str': conn_str,
        'internal_client': internal_client
    }
    external_client.user_data_set(userdata)
    
    print("Connecting to external MQTT broker...")
    external_client.connect(external_config['host'], external_config['port'], 60)
    external_client.reconnect_delay_set(min_delay=1, max_delay=120)
    
    # Run the loop
    external_client.loop_forever()

if __name__ == "__main__":
    main()