-- MES-SAP Integration Testing Database Schema
-- MS SQL Server T-SQL Script
-- Create database and tables based on functional spec

-- Create Database (if not exists)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'MESDB')
BEGIN
    CREATE DATABASE MESDB;
END
GO

USE MESDB;
GO

-- 1. Materials Table (Master Data - Interface 4.1.1)
IF OBJECT_ID('dbo.Materials', 'U') IS NOT NULL
    DROP TABLE dbo.Materials;
CREATE TABLE dbo.Materials (
    id INT IDENTITY(1,1) PRIMARY KEY,
    material_code NVARCHAR(50) UNIQUE NOT NULL,
    description NVARCHAR(255),
    material_type NVARCHAR(10) NOT NULL,  -- e.g., 'ROH', 'HALB', 'FERT', 'VERP'
    base_unit NVARCHAR(10),
    batch_managed BIT DEFAULT 1,
    location NVARCHAR(100),
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 DEFAULT GETUTCDATE()
);
GO

-- 2. Batches Table (Master Data - Interface 4.1.2)
IF OBJECT_ID('dbo.Batches', 'U') IS NOT NULL
    DROP TABLE dbo.Batches;
CREATE TABLE dbo.Batches (
    id INT IDENTITY(1,1) PRIMARY KEY,
    batch_number NVARCHAR(50) UNIQUE NOT NULL,
    material_id INT,
    manufacture_date DATE,
    expiry_date DATE,
    quantity DECIMAL(18,3),
    status NVARCHAR(20) DEFAULT 'Active',
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (material_id) REFERENCES dbo.Materials(id) ON DELETE CASCADE
);
GO

-- 3. Resources Table (Master Data - Interface 4.1.3)
IF OBJECT_ID('dbo.Resources', 'U') IS NOT NULL
    DROP TABLE dbo.Resources;
CREATE TABLE dbo.Resources (
    id INT IDENTITY(1,1) PRIMARY KEY,
    work_center_code NVARCHAR(50) UNIQUE NOT NULL,
    description NVARCHAR(255),
    capacity DECIMAL(10,2),
    location NVARCHAR(100),
    area NVARCHAR(50),
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 DEFAULT GETUTCDATE()
);
GO

-- 4. PlannedHandlingUnits Table (Master Data/Transactional - Interfaces 4.1.4 & 4.2.4)
IF OBJECT_ID('dbo.PlannedHandlingUnits', 'U') IS NOT NULL
    DROP TABLE dbo.PlannedHandlingUnits;
CREATE TABLE dbo.PlannedHandlingUnits (
    id INT IDENTITY(1,1) PRIMARY KEY,
    hu_number NVARCHAR(50) UNIQUE NOT NULL,
    process_order_id INT,
    material_id INT,
    expected_quantity DECIMAL(18,3),
    packaging_type NVARCHAR(50),
    label_template NVARCHAR(255),
    status NVARCHAR(20) DEFAULT 'Planned',
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (process_order_id) REFERENCES dbo.ProcessOrders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES dbo.Materials(id) ON DELETE CASCADE
);
GO

-- 5. ProcessOrders Table (Transactional - Interfaces 4.2.1-4.2.3)
IF OBJECT_ID('dbo.ProcessOrders', 'U') IS NOT NULL
    DROP TABLE dbo.ProcessOrders;
CREATE TABLE dbo.ProcessOrders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_number NVARCHAR(50) UNIQUE NOT NULL,
    material_id INT,
    batch_id INT NULL,
    resource_id INT,
    quantity_ordered DECIMAL(18,3),
    quantity_produced DECIMAL(18,3) DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'Released',
    goods_receipt_posted BIT DEFAULT 0,
    consumption_posted BIT DEFAULT 0,
    scenario NVARCHAR(10),  -- e.g., 'HALB', 'FERT'
    location NVARCHAR(100),
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
    CompletedAt DATETIME2 NULL,
    FOREIGN KEY (material_id) REFERENCES dbo.Materials(id) ON DELETE SET NULL,
    FOREIGN KEY (batch_id) REFERENCES dbo.Batches(id) ON DELETE SET NULL,
    FOREIGN KEY (resource_id) REFERENCES dbo.Resources(id) ON DELETE SET NULL
);
GO

-- 6. StagingRequests Table (Transactional - Interfaces 4.2.5-4.2.6)
IF OBJECT_ID('dbo.StagingRequests', 'U') IS NOT NULL
    DROP TABLE dbo.StagingRequests;
CREATE TABLE dbo.StagingRequests (
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(50) UNIQUE NOT NULL,
    material_id INT,
    storage_location NVARCHAR(100) NOT NULL,
    quantity_requested DECIMAL(18,3),
    quantity_delivered DECIMAL(18,3) DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'Requested',
    movement_type NVARCHAR(10),
    location NVARCHAR(100),
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (material_id) REFERENCES dbo.Materials(id) ON DELETE SET NULL
);
GO

-- 7. EventsLog Table (Logs - General Events)
IF OBJECT_ID('dbo.EventsLog', 'U') IS NOT NULL
    DROP TABLE dbo.EventsLog;
CREATE TABLE dbo.EventsLog (
    id INT IDENTITY(1,1) PRIMARY KEY,
    event_type NVARCHAR(50) NOT NULL,
    process_order_id INT NULL,
    staging_request_id INT NULL,
    payload NVARCHAR(MAX),
    status NVARCHAR(20),
    location NVARCHAR(100),
    timestamp DATETIME2 DEFAULT GETUTCDATE(),
    FOREIGN KEY (process_order_id) REFERENCES dbo.ProcessOrders(id) ON DELETE SET NULL,
    FOREIGN KEY (staging_request_id) REFERENCES dbo.StagingRequests(id) ON DELETE SET NULL
);
GO

-- 8. ApiResponsesLog Table (Logs - SAP API Calls)
IF OBJECT_ID('dbo.ApiResponsesLog', 'U') IS NOT NULL
    DROP TABLE dbo.ApiResponsesLog;
CREATE TABLE dbo.ApiResponsesLog (
    id INT IDENTITY(1,1) PRIMARY KEY,
    api_endpoint NVARCHAR(255),
    method NVARCHAR(10) DEFAULT 'GET',
    request_params NVARCHAR(MAX),
    response_data NVARCHAR(MAX),
    status_code INT,
    error_message NVARCHAR(500) NULL,
    timestamp DATETIME2 DEFAULT GETUTCDATE()
);
GO

-- 9. MqttMessagesLog Table (Logs - MQTT Activity)
IF OBJECT_ID('dbo.MqttMessagesLog', 'U') IS NOT NULL
    DROP TABLE dbo.MqttMessagesLog;
CREATE TABLE dbo.MqttMessagesLog (
    id INT IDENTITY(1,1) PRIMARY KEY,
    topic NVARCHAR(255) NOT NULL,
    message_type NVARCHAR(20),
    payload NVARCHAR(MAX),
    broker NVARCHAR(50),
    status NVARCHAR(20),
    timestamp DATETIME2 DEFAULT GETUTCDATE()
);
GO

-- Indexes for Performance
CREATE INDEX IX_Materials_MaterialCode ON dbo.Materials(material_code);
CREATE INDEX IX_Batches_BatchNumber ON dbo.Batches(batch_number);
CREATE INDEX IX_Resources_WorkCenterCode ON dbo.Resources(work_center_code);
CREATE INDEX IX_ProcessOrders_OrderNumber ON dbo.ProcessOrders(order_number);
CREATE INDEX IX_ProcessOrders_Status ON dbo.ProcessOrders(status);
CREATE INDEX IX_StagingRequests_RequestId ON dbo.StagingRequests(request_id);
CREATE INDEX IX_StagingRequests_Status ON dbo.StagingRequests(status);
CREATE INDEX IX_EventsLog_EventType ON dbo.EventsLog(event_type);
CREATE INDEX IX_EventsLog_Timestamp ON dbo.EventsLog(timestamp);
CREATE INDEX IX_ApiResponsesLog_Timestamp ON dbo.ApiResponsesLog(timestamp);
CREATE INDEX IX_MqttMessagesLog_Topic ON dbo.MqttMessagesLog(topic);
CREATE INDEX IX_MqttMessagesLog_Timestamp ON dbo.MqttMessagesLog(timestamp);
GO

-- Optional: Triggers for UpdatedAt
CREATE TRIGGER TR_Materials_UpdatedAt
ON dbo.Materials
AFTER UPDATE
AS
BEGIN
    UPDATE m
    SET UpdatedAt = GETUTCDATE()
    FROM dbo.Materials m
    INNER JOIN inserted i ON m.id = i.id;
END;
GO

-- Similar triggers for other tables can be added...

-- Sample Data for Testing
-- Sample Materials
INSERT INTO dbo.Materials (material_code, description, material_type, base_unit, batch_managed, location)
VALUES 
    ('MAT-001', 'Raw Chemical A', 'ROH', 'KG', 1, 'ACME/China/Pinghu/Area1'),
    ('MAT-002', 'Semi-Finished B', 'HALB', 'KG', 1, 'ACME/China/Pinghu/Area1'),
    ('MAT-003', 'Finished Product C', 'FERT', 'EA', 1, 'ACME/China/Pinghu/Area1'),
    ('PKG-001', 'Packaging Box', 'VERP', 'EA', 0, 'ACME/China/Pinghu/Area1');

-- Sample Batches
INSERT INTO dbo.Batches (batch_number, material_id, manufacture_date, expiry_date, quantity, status)
VALUES 
    ('BATCH-001', 1, '2025-01-01', '2026-01-01', 1000.0, 'Active'),
    ('BATCH-002', 2, '2025-02-01', '2026-02-01', 500.0, 'Active');

-- Sample Resources
INSERT INTO dbo.Resources (work_center_code, description, capacity, location, area)
VALUES 
    ('WC1', 'Work Center 1 Mixer', 1000.0, 'ACME/China/Pinghu/Area1/WorkCenter1', 'Area1'),
    ('WC2', 'Work Center 2 Packer', 500.0, 'ACME/China/Pinghu/Area1/WorkCenter2', 'Area1');

-- Sample Process Order
INSERT INTO dbo.ProcessOrders (order_number, material_id, batch_id, resource_id, quantity_ordered, status, scenario, location)
VALUES 
    ('PO123', 3, 2, 1, 100.0, 'Released', 'FERT', 'ACME/China/Pinghu/Area1/WorkCenter1/MES');

-- Sample Staging Request
INSERT INTO dbo.StagingRequests (request_id, material_id, storage_location, quantity_requested, status, location)
VALUES 
    ('REQ001', 1, 'SLoc-0101', 200.0, 'Requested', 'ACME/China/Pinghu/Area1');

-- Sample Planned HU
INSERT INTO dbo.PlannedHandlingUnits (hu_number, process_order_id, material_id, expected_quantity, packaging_type, status)
VALUES 
    ('SSCC12345678901234567', 1, 3, 50.0, 'Pallet', 'Planned');

-- Sample Logs
INSERT INTO dbo.EventsLog (event_type, process_order_id, payload, status, location)
VALUES 
    ('ProcessOrderReleased', 1, '{"orderNumber": "PO123", "quantity": 100}', 'Success', 'ACME/China/Pinghu/Area1');

INSERT INTO dbo.ApiResponsesLog (api_endpoint, request_params, response_data, status_code)
VALUES 
    ('/processorders/PO123', '{"orderId": "PO123"}', '{"data": "Sample response"}', 200);

INSERT INTO dbo.MqttMessagesLog (topic, message_type, payload, broker, status)
VALUES 
    ('ACME/China/Pinghu/Area1/SAP Workcenters/ProcessOrder/Create', 'Publish', '{"orderNumber": "PO123"}', 'Internal-Mosquitto', 'Sent');
GO

PRINT 'MESDB schema created successfully with sample data.';