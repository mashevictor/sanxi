-- 派单系统数据库建表 SQL (PostgreSQL/MySQL 通用参考)
-- SQLite 版本请使用 prisma/schema.prisma

-- ==================== 城市表 ====================
CREATE TABLE cities (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    code        VARCHAR(20) UNIQUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 招商园区表 ====================
CREATE TABLE investment_parks (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    city_id     INTEGER REFERENCES cities(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 员工表 ====================
CREATE TABLE employees (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(50) NOT NULL,
    city_id           INTEGER NOT NULL REFERENCES cities(id),
    park_id           INTEGER NOT NULL REFERENCES investment_parks(id),
    roles             JSONB NOT NULL,          -- ["FRONT","PROJECT"] 或 ["BACK"]
    status            VARCHAR(20) DEFAULT 'ACTIVE',  -- ACTIVE/INACTIVE/LEAVE
    departure_address TEXT NOT NULL,
    plus_capabilities JSONB NOT NULL,          -- {"FRONT":["Plus0","Plus1"],"BACK":["Plus0","Plus1","PlusN"]}
    order_capacity    JSONB NOT NULL,          -- ["MORNING","AFTERNOON_1"]
    remark            TEXT,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_employees_city ON employees(city_id);
CREATE INDEX idx_employees_park ON employees(park_id);
CREATE INDEX idx_employees_status ON employees(status);

-- ==================== 客户/订单表 ====================
CREATE TABLE customers (
    id                SERIAL PRIMARY KEY,
    company_name      VARCHAR(200) NOT NULL,
    address           TEXT NOT NULL,
    customer_type     VARCHAR(20) NOT NULL,    -- FIRST_VISIT/PROJECT/FOLLOW_UP
    appointment_time  TIMESTAMP NOT NULL,
    time_slot         VARCHAR(20) NOT NULL,    -- MORNING/AFTERNOON_1/AFTERNOON_2
    city_id           INTEGER NOT NULL REFERENCES cities(id),
    park_id           INTEGER NOT NULL REFERENCES investment_parks(id),
    plus_count        INTEGER DEFAULT 0,
    designated_person VARCHAR(50),
    rejected_person   VARCHAR(50),
    is_hand_in_hand   BOOLEAN DEFAULT FALSE,
    hand_in_hand_group VARCHAR(50),
    remark            TEXT,
    dispatch_status   VARCHAR(20) DEFAULT 'PENDING',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customers_type ON customers(customer_type);
CREATE INDEX idx_customers_slot ON customers(time_slot);
CREATE INDEX idx_customers_park ON customers(park_id);
CREATE INDEX idx_customers_status ON customers(dispatch_status);
CREATE INDEX idx_customers_hih ON customers(hand_in_hand_group);

-- ==================== 派单批次表 ====================
CREATE TABLE dispatch_batches (
    id                  SERIAL PRIMARY KEY,
    batch_date          DATE NOT NULL,
    front_project_mode  VARCHAR(20) DEFAULT 'RANDOM',
    total_customers     INTEGER,
    total_employees     INTEGER,
    status              VARCHAR(20) DEFAULT 'PROCESSING',
    remark              TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 派单结果表 ====================
CREATE TABLE dispatch_results (
    id              SERIAL PRIMARY KEY,
    batch_id        INTEGER NOT NULL REFERENCES dispatch_batches(id),
    customer_id     INTEGER NOT NULL REFERENCES customers(id),
    employee_id     INTEGER NOT NULL REFERENCES employees(id),
    commute_minutes INTEGER,
    match_score     DECIMAL(5,2),
    match_details   JSONB,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_id, customer_id)
);

CREATE INDEX idx_results_batch ON dispatch_results(batch_id);
CREATE INDEX idx_results_employee ON dispatch_results(employee_id);

-- ==================== 系统配置表 ====================
CREATE TABLE system_configs (
    id    SERIAL PRIMARY KEY,
    key   VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL
);

-- ==================== 初始数据 ====================
INSERT INTO cities (name, code) VALUES
    ('上海市', 'SH'),
    ('杭州市', 'HZ'),
    ('苏州市', 'SZ'),
    ('成都市', 'CD');

INSERT INTO investment_parks (name, city_id) VALUES
    ('宝山高新', 1),
    ('加盟-金山资本现代产业园', 1),
    ('江苏徐州', 1),
    ('江苏镇江', 1),
    ('山东济南', 1);

INSERT INTO system_configs (key, value) VALUES
    ('dispatch_config', '{
        "frontProjectMode": "RANDOM",
        "maxTotalCommuteMinutes": 240,
        "maxMorningCommuteMinutes": 180,
        "maxAfternoonCommuteMinutes": 210,
        "maxAfternoon2CommuteMinutes": 60,
        "enableDistanceOptimization": true,
        "allowCommuteOverridePlus": true
    }');
