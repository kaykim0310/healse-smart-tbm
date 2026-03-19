-- ============================================
-- TBM 음성 AI 시스템 데이터베이스 스키마
-- 네이버 클라우드 Cloud DB for MySQL용
-- ============================================

-- 데이터베이스 생성
CREATE DATABASE IF NOT EXISTS tbm_system
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE tbm_system;

-- ============================================
-- 1. 고객사 테이블 (B2B 고객 관리)
-- ============================================
CREATE TABLE companies (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '회사명',
    business_number VARCHAR(20) COMMENT '사업자등록번호',
    industry VARCHAR(50) COMMENT '업종 (건설, 제조 등)',
    contact_name VARCHAR(50) COMMENT '담당자명',
    contact_email VARCHAR(100) COMMENT '담당자 이메일',
    contact_phone VARCHAR(20) COMMENT '담당자 연락처',
    plan_type ENUM('basic', 'standard', 'premium', 'enterprise') DEFAULT 'basic' COMMENT '요금제',
    monthly_limit INT DEFAULT 100 COMMENT '월간 TBM 한도',
    status ENUM('active', 'suspended', 'cancelled') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_plan (plan_type)
) COMMENT 'B2B 고객사 정보';

-- ============================================
-- 2. 사용자 테이블 (고객사별 사용자)
-- ============================================
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL,
    email VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL COMMENT '이름',
    role ENUM('admin', 'manager', 'user') DEFAULT 'user' COMMENT '권한',
    department VARCHAR(50) COMMENT '부서',
    phone VARCHAR(20) COMMENT '연락처',
    language VARCHAR(5) DEFAULT 'ko' COMMENT '선호 언어',
    last_login_at TIMESTAMP NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE INDEX idx_email (email),
    INDEX idx_company (company_id)
) COMMENT '사용자 계정';

-- ============================================
-- 3. TBM 세션 테이블 (회의 기록)
-- ============================================
CREATE TABLE tbm_sessions (
    id VARCHAR(36) PRIMARY KEY,
    session_code VARCHAR(10) NOT NULL COMMENT '세션 입장 코드',
    company_id VARCHAR(36) NOT NULL,
    created_by VARCHAR(36) NOT NULL COMMENT '생성자 (리더)',
    
    -- 기본 정보
    meeting_date DATE NOT NULL COMMENT '회의 날짜',
    meeting_time TIME COMMENT '회의 시간',
    location VARCHAR(100) COMMENT '회의 장소',
    department VARCHAR(50) COMMENT '부서/팀',
    
    -- 작업 정보
    work_location VARCHAR(200) COMMENT '작업 장소',
    work_content TEXT COMMENT '작업 내용',
    preparation TEXT COMMENT '준비물',
    precautions TEXT COMMENT '주의사항',
    
    -- 상태
    status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
    language VARCHAR(5) DEFAULT 'ko' COMMENT '회의 언어',
    
    -- AI 분석
    ai_analyzed_at TIMESTAMP NULL COMMENT 'AI 분석 시각',
    ai_analysis_result JSON COMMENT 'AI 분석 원본 결과',
    
    -- 시간 기록
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE INDEX idx_session_code (session_code),
    INDEX idx_company_date (company_id, meeting_date),
    INDEX idx_status (status)
) COMMENT 'TBM 회의 세션';

-- ============================================
-- 4. 세션 참여자 테이블
-- ============================================
CREATE TABLE session_participants (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NULL COMMENT '등록된 사용자면 연결',
    name VARCHAR(50) NOT NULL COMMENT '참여자 이름',
    role ENUM('leader', 'participant') DEFAULT 'participant',
    
    -- 서명
    signature_data LONGTEXT COMMENT '서명 이미지 (Base64)',
    signed_at TIMESTAMP NULL,
    
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES tbm_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_session (session_id)
) COMMENT 'TBM 참여자';

-- ============================================
-- 5. PPE 체크리스트 테이블
-- ============================================
CREATE TABLE session_ppe_checklist (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    ppe_type VARCHAR(50) NOT NULL COMMENT '보호구 종류',
    is_checked BOOLEAN DEFAULT FALSE,
    checked_by VARCHAR(36) NULL,
    checked_at TIMESTAMP NULL,
    
    FOREIGN KEY (session_id) REFERENCES tbm_sessions(id) ON DELETE CASCADE,
    INDEX idx_session (session_id)
) COMMENT 'PPE 체크 기록';

-- ============================================
-- 6. 음성 녹취록 테이블
-- ============================================
CREATE TABLE session_transcripts (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    speaker_name VARCHAR(50) COMMENT '발화자',
    transcript_text TEXT NOT NULL COMMENT '녹취 내용',
    audio_file_url VARCHAR(500) COMMENT '원본 음성 파일 URL',
    
    -- STT 정보
    confidence_score DECIMAL(5,4) COMMENT 'STT 신뢰도',
    language VARCHAR(5) DEFAULT 'ko',
    
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES tbm_sessions(id) ON DELETE CASCADE,
    INDEX idx_session (session_id),
    FULLTEXT INDEX idx_transcript (transcript_text)
) COMMENT '음성 녹취록';

-- ============================================
-- 7. 위험성평가 테이블
-- ============================================
CREATE TABLE risk_assessments (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    
    -- 위험 정보
    location VARCHAR(200) COMMENT '위험 장소',
    activity VARCHAR(200) COMMENT '작업 내용',
    hazard VARCHAR(500) NOT NULL COMMENT '위험요인',
    
    -- 위험성 평가 (빈도 x 강도)
    frequency INT CHECK (frequency BETWEEN 1 AND 5) COMMENT '빈도 (1-5)',
    severity INT CHECK (severity BETWEEN 1 AND 4) COMMENT '강도 (1-4)',
    risk_score INT GENERATED ALWAYS AS (frequency * severity) STORED COMMENT '위험점수',
    risk_level ENUM('low', 'medium', 'high') GENERATED ALWAYS AS (
        CASE 
            WHEN frequency * severity >= 12 THEN 'high'
            WHEN frequency * severity >= 6 THEN 'medium'
            ELSE 'low'
        END
    ) STORED COMMENT '위험등급',
    
    -- 대책
    countermeasure TEXT COMMENT '안전대책',
    responsible_person VARCHAR(50) COMMENT '담당자',
    due_date DATE COMMENT '이행 기한',
    is_resolved BOOLEAN DEFAULT FALSE COMMENT '조치 완료 여부',
    resolved_at TIMESTAMP NULL,
    
    -- 출처
    source ENUM('ai', 'manual') DEFAULT 'manual' COMMENT '등록 방법',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES tbm_sessions(id) ON DELETE CASCADE,
    INDEX idx_session (session_id),
    INDEX idx_risk_level (risk_level),
    INDEX idx_unresolved (is_resolved, risk_level)
) COMMENT '위험성평가 결과';

-- ============================================
-- 8. 교육자료 테이블
-- ============================================
CREATE TABLE education_materials (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    
    -- 자료 정보
    title VARCHAR(200) NOT NULL,
    slide_count INT DEFAULT 0 COMMENT '슬라이드 수',
    duration_minutes INT DEFAULT 10 COMMENT '예상 소요시간',
    
    -- 파일
    slides_json JSON COMMENT '슬라이드 내용 (JSON)',
    ppt_file_url VARCHAR(500) COMMENT 'PPT 파일 URL',
    pdf_file_url VARCHAR(500) COMMENT 'PDF 파일 URL',
    video_file_url VARCHAR(500) COMMENT '영상 파일 URL',
    
    -- TTS 나레이션
    narration_text TEXT COMMENT '나레이션 스크립트',
    narration_audio_url VARCHAR(500) COMMENT '나레이션 음성 URL',
    
    language VARCHAR(5) DEFAULT 'ko',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES tbm_sessions(id) ON DELETE CASCADE,
    INDEX idx_session (session_id)
) COMMENT '자동 생성 교육자료';

-- ============================================
-- 9. API 사용량 로그 (과금용)
-- ============================================
CREATE TABLE api_usage_logs (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL,
    session_id VARCHAR(36) NULL,
    
    -- API 정보
    api_type ENUM('clova_speech', 'clova_voice', 'claude', 'other') NOT NULL,
    endpoint VARCHAR(200) COMMENT 'API 엔드포인트',
    
    -- 사용량
    input_units INT DEFAULT 0 COMMENT '입력 단위 (토큰, 초, 글자 등)',
    output_units INT DEFAULT 0 COMMENT '출력 단위',
    estimated_cost DECIMAL(10,2) COMMENT '예상 비용 (원)',
    
    -- 결과
    status_code INT COMMENT 'HTTP 상태 코드',
    response_time_ms INT COMMENT '응답 시간 (밀리초)',
    error_message TEXT COMMENT '오류 메시지',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (session_id) REFERENCES tbm_sessions(id),
    INDEX idx_company_date (company_id, created_at),
    INDEX idx_api_type (api_type, created_at)
) COMMENT 'API 사용량 로그';

-- ============================================
-- 10. 시스템 로그
-- ============================================
CREATE TABLE system_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    level ENUM('debug', 'info', 'warn', 'error') DEFAULT 'info',
    category VARCHAR(50) COMMENT '로그 카테고리',
    message TEXT NOT NULL,
    details JSON COMMENT '상세 정보',
    user_id VARCHAR(36) NULL,
    ip_address VARCHAR(45) COMMENT 'IP 주소',
    user_agent VARCHAR(500) COMMENT '브라우저 정보',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_level_date (level, created_at),
    INDEX idx_category (category, created_at)
) COMMENT '시스템 로그';

-- ============================================
-- 초기 데이터 삽입
-- ============================================

-- 기본 PPE 종류
CREATE TABLE ppe_types (
    id VARCHAR(20) PRIMARY KEY,
    name_ko VARCHAR(50) NOT NULL,
    name_en VARCHAR(50) NOT NULL,
    name_th VARCHAR(50),
    name_vi VARCHAR(50),
    icon VARCHAR(10) COMMENT '이모지 아이콘',
    display_order INT DEFAULT 0
) COMMENT 'PPE 종류 마스터';

INSERT INTO ppe_types (id, name_ko, name_en, name_th, name_vi, icon, display_order) VALUES
('ppe1', '안전모', 'Hard Hat', 'หมวกนิรภัย', 'Mũ bảo hiểm', '🪖', 1),
('ppe2', '안전화', 'Safety Shoes', 'รองเท้านิรภัย', 'Giày bảo hộ', '👟', 2),
('ppe3', '안전장갑', 'Safety Gloves', 'ถุงมือนิรภัย', 'Găng tay', '🧤', 3),
('ppe4', '보안경', 'Safety Glasses', 'แว่นตานิรภัย', 'Kính bảo hộ', '🥽', 4),
('ppe5', '방진마스크', 'Dust Mask', 'หน้ากากกันฝุ่น', 'Khẩu trang', '😷', 5),
('ppe6', '귀마개', 'Ear Plugs', 'ที่อุดหู', 'Nút tai', '🔇', 6),
('ppe7', '안전대', 'Safety Harness', 'เข็มขัดนิรภัย', 'Dây an toàn', '🦺', 7);

-- 위험 카테고리
CREATE TABLE hazard_categories (
    id VARCHAR(20) PRIMARY KEY,
    name_ko VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    keywords TEXT COMMENT '키워드 (검색용)',
    typical_countermeasures TEXT COMMENT '일반적인 대책'
) COMMENT '위험 카테고리 마스터';

INSERT INTO hazard_categories (id, name_ko, name_en, keywords, typical_countermeasures) VALUES
('fall', '추락', 'Fall', '고소,사다리,비계,지붕,높은', '안전대 착용, 안전난간 설치, 작업발판 점검'),
('electric', '감전', 'Electric Shock', '전기,전원,배선,감전,220V', '전원 차단, 절연장갑 착용, 접지 확인'),
('fire', '화재/폭발', 'Fire/Explosion', '화재,용접,불꽃,가연물,폭발', '소화기 비치, 화기작업 허가, 가연물 제거'),
('crush', '협착/충돌', 'Crush/Collision', '기계,프레스,컨베이어,협착', '방호장치 확인, 안전거리 유지, 잠금장치'),
('suffocation', '질식', 'Suffocation', '밀폐,산소,환기,맨홀', '산소농도 측정, 환기, 감시인 배치'),
('chemical', '화학물질', 'Chemical', '유해물질,화학,MSDS,독성', '보호구 착용, MSDS 확인, 환기'),
('drop', '낙하/비래', 'Falling Object', '낙하,크레인,인양,중량물', '안전모 착용, 작업반경 통제, 낙하방지망'),
('slip', '미끄러짐/전도', 'Slip/Trip', '미끄러짐,넘어짐,정리정돈', '정리정돈, 미끄럼방지, 안전통로 확보');

-- ============================================
-- 뷰 생성 (자주 사용하는 쿼리)
-- ============================================

-- 일별 TBM 현황
CREATE VIEW v_daily_tbm_summary AS
SELECT 
    company_id,
    meeting_date,
    COUNT(*) as session_count,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
    COUNT(DISTINCT session_id) as unique_participants
FROM tbm_sessions s
LEFT JOIN session_participants p ON s.id = p.session_id
GROUP BY company_id, meeting_date;

-- 고위험 항목 현황
CREATE VIEW v_high_risk_items AS
SELECT 
    r.*,
    s.company_id,
    s.meeting_date,
    s.work_location,
    s.work_content
FROM risk_assessments r
JOIN tbm_sessions s ON r.session_id = s.id
WHERE r.risk_level = 'high' AND r.is_resolved = FALSE;

-- ============================================
-- 완료 메시지
-- ============================================
SELECT 'TBM 시스템 데이터베이스 스키마가 성공적으로 생성되었습니다!' as message;
