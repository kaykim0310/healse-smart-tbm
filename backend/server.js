/**
 * TBM 음성 AI 시스템 - 백엔드 서버
 * 
 * 이 파일이 하는 일:
 * 1. 웹 서버 실행 (사용자가 접속할 수 있게)
 * 2. API 제공 (데이터 저장/조회)
 * 3. AI 분석 연동 (Claude API)
 * 4. 세션/사용자 관리
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ============== 미들웨어 설정 ==============
app.use(cors()); // 다른 도메인에서도 접근 가능
app.use(bodyParser.json({ limit: '50mb' })); // JSON 데이터 처리
// HTML 파일은 캐시하지 않도록 설정 (항상 최신 버전 제공)
app.use(express.static(path.join(__dirname, '../frontend'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// ============== 임시 데이터베이스 (메모리) ==============
// 실제 서비스에서는 MySQL이나 MongoDB로 교체
const database = {
    users: new Map(),      // 사용자 정보
    sessions: new Map(),   // TBM 세션
    companies: new Map(),  // 고객사 정보
    riskData: new Map(),   // 위험성평가 데이터
};

// ============== 유틸리티 함수 ==============
function generateSessionCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getCurrentTime() {
    return new Date().toISOString();
}

// ============== API 엔드포인트 ==============

/**
 * 서버 상태 확인
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'TBM 서버가 정상 작동 중입니다',
        timestamp: getCurrentTime(),
        version: '1.0.0'
    });
});

/**
 * 새 TBM 세션 생성
 * POST /api/sessions
 */
app.post('/api/sessions', (req, res) => {
    const { userName, companyId, language = 'ko' } = req.body;

    if (!userName) {
        return res.status(400).json({ error: '사용자 이름이 필요합니다' });
    }

    const sessionCode = generateSessionCode();
    const sessionId = uuidv4();

    const session = {
        id: sessionId,
        code: sessionCode,
        companyId: companyId || 'default',
        language,
        createdBy: userName,
        createdAt: getCurrentTime(),
        status: 'active',
        participants: [{
            id: uuidv4(),
            name: userName,
            role: 'leader',
            joinedAt: getCurrentTime(),
            signature: null
        }],
        tbmData: {
            date: new Date().toISOString().split('T')[0],
            time: new Date().toTimeString().slice(0, 5),
            location: '',
            department: '',
            workLocation: '',
            workContent: '',
            preparation: '',
            precautions: ''
        },
        ppeChecklist: [],
        riskAssessments: [],
        transcript: [],
        educationMaterial: null
    };

    database.sessions.set(sessionCode, session);

    console.log(`[세션 생성] 코드: ${sessionCode}, 리더: ${userName}`);

    res.json({
        success: true,
        sessionCode,
        sessionId,
        message: '새 TBM 세션이 생성되었습니다'
    });
});

/**
 * 기존 세션 참여
 * POST /api/sessions/:code/join
 */
app.post('/api/sessions/:code/join', (req, res) => {
    const { code } = req.params;
    const { userName } = req.body;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    if (session.status !== 'active') {
        return res.status(400).json({ error: '이미 종료된 세션입니다' });
    }

    const participant = {
        id: uuidv4(),
        name: userName,
        role: 'participant',
        joinedAt: getCurrentTime(),
        signature: null
    };

    session.participants.push(participant);

    console.log(`[세션 참여] 코드: ${code}, 참여자: ${userName}`);

    res.json({
        success: true,
        session: {
            code: session.code,
            participants: session.participants,
            tbmData: session.tbmData,
            riskAssessments: session.riskAssessments
        }
    });
});

/**
 * 세션 정보 조회
 * GET /api/sessions/:code
 */
app.get('/api/sessions/:code', (req, res) => {
    const { code } = req.params;
    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    res.json({ success: true, session });
});

/**
 * TBM 기본 정보 업데이트
 * PUT /api/sessions/:code/tbm-data
 */
app.put('/api/sessions/:code/tbm-data', (req, res) => {
    const { code } = req.params;
    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    session.tbmData = { ...session.tbmData, ...req.body };
    session.updatedAt = getCurrentTime();

    res.json({ success: true, tbmData: session.tbmData });
});

/**
 * PPE 체크리스트 저장
 * PUT /api/sessions/:code/ppe
 */
app.put('/api/sessions/:code/ppe', (req, res) => {
    const { code } = req.params;
    const { checklist, otherPpe } = req.body;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    session.ppeChecklist = checklist || [];
    session.tbmData.otherPpe = otherPpe || '';
    session.updatedAt = getCurrentTime();

    res.json({ success: true, ppeChecklist: session.ppeChecklist });
});

/**
 * 음성 텍스트 추가 (녹음된 내용)
 * POST /api/sessions/:code/transcript
 */
app.post('/api/sessions/:code/transcript', (req, res) => {
    const { code } = req.params;
    const { speaker, text, timestamp } = req.body;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    const entry = {
        id: uuidv4(),
        speaker,
        text,
        timestamp: timestamp || getCurrentTime()
    };

    session.transcript.push(entry);

    res.json({ success: true, entry });
});

/**
 * AI 위험성 분석 요청
 * POST /api/sessions/:code/analyze
 * 
 * 이 API가 Claude를 호출하여 위험성평가를 자동 생성합니다
 */
app.post('/api/sessions/:code/analyze', async (req, res) => {
    const { code } = req.params;
    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    // 회의 내용 취합
    const transcriptText = session.transcript.map(t => `${t.speaker}: ${t.text}`).join('\n');
    const workInfo = `
        작업장소: ${session.tbmData.workLocation}
        작업내용: ${session.tbmData.workContent}
        준비물: ${session.tbmData.preparation}
        주의사항: ${session.tbmData.precautions}
    `;

    try {
        // AI 분석 수행 (실제로는 Claude API 호출)
        const aiResult = await performAIAnalysis(transcriptText, workInfo, session.language);

        // 결과 저장
        session.riskAssessments = aiResult.risks;
        session.aiAnalyzedAt = getCurrentTime();

        console.log(`[AI 분석 완료] 세션: ${code}, 위험요인: ${aiResult.risks.length}건`);

        res.json({
            success: true,
            analysis: aiResult,
            message: 'AI 분석이 완료되었습니다'
        });
    } catch (error) {
        console.error('AI 분석 오류:', error);
        res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다' });
    }
});

/**
 * AI 분석 함수 (Claude API 연동)
 * 실제 서비스에서는 Anthropic API를 호출합니다
 */
async function performAIAnalysis(transcript, workInfo, language) {
    // Claude API 키가 있으면 실제 호출
    const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

    if (CLAUDE_API_KEY) {
        // 실제 Claude API 호출 코드
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: `당신은 산업안전보건 전문가입니다. 다음 TBM 회의 내용을 분석하여 위험성평가를 작성해주세요.

[작업 정보]
${workInfo}

[회의 내용]
${transcript}

다음 JSON 형식으로 위험요인을 분석해주세요.
중요: 출력되는 모든 값(value)은 반드시 '${language}' 언어로 번역해서 작성하세요. 단, JSON 키(key)는 변경하지 마세요.

{
    "risks": [
        {
            "location": "작업 장소",
            "activity": "작업 내용",
            "hazard": "위험요인",
            "frequency": 1-5 (빈도),
            "severity": 1-4 (강도),
            "countermeasure": "안전대책"
        }
    ],
    "summary": "전체 요약",
    "recommendations": ["추가 권장사항"]
}`
                }]
            })
        });

        const data = await response.json();
        // 응답 파싱 및 반환
        try {
            const content = data.content[0].text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('AI 응답 파싱 오류:', e);
        }
    }

    // API 키가 없거나 오류 시 시뮬레이션 데이터 반환
    return await simulateAIAnalysis(transcript, workInfo, language);
}

/**
 * AI 분석 시뮬레이션 (데모용)
 */
async function translateTextAsync(text, targetLang) {
    if(!targetLang || targetLang === 'ko' || targetLang === 'Korean') return text;
    
    const nameToCode = {
        'English': 'en', 'Chinese': 'zh-CN', 'Vietnamese': 'vi', 'Thai': 'th',
        'Indonesian': 'id', 'Uzbek': 'uz', 'Khmer': 'km', 'Mongolian': 'mn',
        'Filipino': 'tl', 'Nepali': 'ne', 'Sinhala': 'si', 'Burmese': 'my',
        'Bengali': 'bn', 'Russian': 'ru'
    };
    const langCode = nameToCode[targetLang] || targetLang;
    if(langCode === 'ko' || langCode === 'Korean') return text;

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=${langCode}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        const data = await res.json();
        let translated = '';
        for (let i = 0; i < data[0].length; i++) {
            if (data[0][i][0]) translated += data[0][i][0];
        }
        return translated;
    } catch(e) { return text; }
}

async function simulateAIAnalysis(transcript, workInfo, language) {
    const risks = [];
    const text = (transcript + workInfo).toLowerCase();

    // 키워드 기반 위험요인 분석
    if (text.includes('고소') || text.includes('사다리') || text.includes('높은')) {
        risks.push({
            id: uuidv4(), location: '작업 현장', activity: '고소작업', hazard: '추락 위험', frequency: 3, severity: 4, countermeasure: '안전대 착용, 2인 1조 작업, 작업발판 설치'
        });
    }

    if (text.includes('용접') || text.includes('화재') || text.includes('불꽃')) {
        risks.push({
            id: uuidv4(), location: '작업 현장', activity: '용접 작업', hazard: '화재/화상 위험', frequency: 3, severity: 3, countermeasure: '소화기 비치, 불꽃 비산 방지막 설치, 화기작업 허가'
        });
    }

    if (text.includes('전원') || text.includes('전기') || text.includes('감전')) {
        risks.push({
            id: uuidv4(), location: '작업 현장', activity: '전기 작업', hazard: '감전 위험', frequency: 2, severity: 4, countermeasure: '전원 차단 확인, 잔류전압 확인, 절연장갑 착용'
        });
    }

    if (text.includes('밀폐') || text.includes('산소') || text.includes('환기')) {
        risks.push({
            id: uuidv4(), location: '작업 현장', activity: '밀폐공간 작업', hazard: '질식 위험', frequency: 2, severity: 4, countermeasure: '산소농도 측정, 환기 실시, 감시인 배치'
        });
    }

    if (text.includes('중량물') || text.includes('크레인') || text.includes('인양')) {
        risks.push({
            id: uuidv4(), location: '작업 현장', activity: '중량물 취급', hazard: '낙하/협착 위험', frequency: 3, severity: 4, countermeasure: '신호수 배치, 작업반경 통제, 와이어 점검'
        });
    }

    // 기본 위험요인 추가
    if (risks.length === 0) {
        risks.push({
            id: uuidv4(), location: '작업 현장', activity: '일반 작업', hazard: '미끄러짐/넘어짐', frequency: 2, severity: 2, countermeasure: '정리정돈, 안전통로 확보, 안전화 착용'
        });
    }

    if (language && language !== 'ko' && language !== 'Korean') {
        for (let risk of risks) {
            risk.location = await translateTextAsync(risk.location, language);
            risk.activity = await translateTextAsync(risk.activity, language);
            risk.hazard = await translateTextAsync(risk.hazard, language);
            risk.countermeasure = await translateTextAsync(risk.countermeasure, language);
        }
    }

    const summaryStr = await translateTextAsync(`총 ${risks.length}건의 위험요인이 식별되었습니다.`, language);
    const rec1 = await translateTextAsync('작업 전 안전교육 실시', language);
    const rec2 = await translateTextAsync('필수 보호구 착용 확인', language);
    const rec3 = await translateTextAsync('비상연락망 확인', language);

    return {
        risks,
        summary: summaryStr,
        recommendations: [rec1, rec2, rec3],
        analyzedAt: getCurrentTime()
    };
}

/**
 * 위험요인 수동 추가
 * POST /api/sessions/:code/risks
 */
app.post('/api/sessions/:code/risks', (req, res) => {
    const { code } = req.params;
    const riskData = req.body;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    const risk = {
        id: uuidv4(),
        ...riskData,
        createdAt: getCurrentTime()
    };

    session.riskAssessments.push(risk);

    res.json({ success: true, risk });
});

/**
 * 위험요인 삭제
 * DELETE /api/sessions/:code/risks/:riskId
 */
app.delete('/api/sessions/:code/risks/:riskId', (req, res) => {
    const { code, riskId } = req.params;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    session.riskAssessments = session.riskAssessments.filter(r => r.id !== riskId);

    res.json({ success: true, message: '위험요인이 삭제되었습니다' });
});

/**
 * 참여자 서명 저장
 * PUT /api/sessions/:code/participants/:participantId/signature
 */
app.put('/api/sessions/:code/participants/:participantId/signature', (req, res) => {
    const { code, participantId } = req.params;
    const { signature } = req.body;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    const participant = session.participants.find(p => p.id === participantId);

    if (!participant) {
        return res.status(404).json({ error: '참여자를 찾을 수 없습니다' });
    }

    participant.signature = signature;
    participant.signedAt = getCurrentTime();

    res.json({ success: true, participant });
});

/**
 * 동영상 교육자료 생성
 * POST /api/sessions/:code/generate-video
 */
app.post('/api/sessions/:code/generate-video', (req, res) => {
    const { code } = req.params;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    // Check if transcript is empty
    if (!session.transcript || session.transcript.length === 0) {
        return res.status(400).json({ error: '녹음된 회의 내용이 없어 영상을 생성할 수 없습니다.' });
    }

    // 회의 내용 취합
    const transcriptText = session.transcript.map(t => `${t.speaker}: ${t.text}`).join('\n');
    const workInfo = `
        작업장소: ${session.tbmData.workLocation}
        작업내용: ${session.tbmData.workContent}
        준비물: ${session.tbmData.preparation}
        주의사항: ${session.tbmData.precautions}
    `;

    const inputData = {
        sessionCode: session.code,
        transcript: transcriptText,
        workInfo: workInfo,
        language: session.language || 'Korean',
        outputDir: path.join(__dirname, '../frontend/videos') // Save to frontend so it's accessible
    };

    console.log(`[교육 영상 생성 시작] 코드: ${code}`);

    // Call the Python script
    const pythonProcess = spawn('python', [
        path.join(__dirname, 'video_generator.py'),
        JSON.stringify(inputData)
    ]);

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
        outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        errorData += data.toString();
        // moviepy logs heavily to stderr, so we might want to just console log it for debugging
        console.log(`[Python Output] ${data.toString()}`);
    });

    pythonProcess.on('close', (codeStatus) => {
        console.log(`[Python Process Exited] 코드: ${codeStatus}`);
        try {
            // Find JSON string in the output (in case there's other printed warnings)
            const jsonStr = outputData.match(/\{.*\}/s)[0];
            const result = JSON.parse(jsonStr);

            if (result.error) {
                res.status(500).json({ error: result.error });
            } else {
                // Return relative path for frontend to load
                session.educationMaterial = {
                    title: result.title,
                    script: result.script,
                    videoUrl: `/videos/${session.code}_education.mp4`,
                    createdAt: getCurrentTime()
                };

                res.json({
                    success: true,
                    message: '비디오 생성이 완료되었습니다',
                    data: session.educationMaterial
                });
            }
        } catch (e) {
            console.error('Python Output Parse Error:', e);
            console.error('Raw Output:', outputData);
            console.error('Raw Error:', errorData);
            res.status(500).json({ error: '영상 생성 중 파이썬 서버 오류가 발생했습니다.' });
        }
    });
});

/**
 * 세션 종료 및 보고서 생성
 * POST /api/sessions/:code/complete
 */
app.post('/api/sessions/:code/complete', (req, res) => {
    const { code } = req.params;

    const session = database.sessions.get(code.toUpperCase());

    if (!session) {
        return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    }

    session.status = 'completed';
    session.completedAt = getCurrentTime();

    // 보고서 데이터 생성
    const report = {
        sessionCode: session.code,
        companyId: session.companyId,
        date: session.tbmData.date,
        time: session.tbmData.time,
        location: session.tbmData.location,
        department: session.tbmData.department,
        workLocation: session.tbmData.workLocation,
        workContent: session.tbmData.workContent,
        participants: session.participants.map(p => ({
            name: p.name,
            role: p.role,
            signed: !!p.signature
        })),
        ppeChecklist: session.ppeChecklist,
        riskAssessments: session.riskAssessments,
        completedAt: session.completedAt
    };

    // 보고서 저장
    database.riskData.set(session.code, report);

    console.log(`[세션 완료] 코드: ${code}`);

    res.json({
        success: true,
        message: 'TBM 회의가 완료되었습니다',
        report
    });
});

/**
 * 회사별 TBM 이력 조회
 * GET /api/companies/:companyId/sessions
 */
app.get('/api/companies/:companyId/sessions', (req, res) => {
    const { companyId } = req.params;
    const { status, startDate, endDate } = req.query;

    const sessions = Array.from(database.sessions.values())
        .filter(s => s.companyId === companyId)
        .filter(s => !status || s.status === status)
        .filter(s => !startDate || s.tbmData.date >= startDate)
        .filter(s => !endDate || s.tbmData.date <= endDate)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
        success: true,
        count: sessions.length,
        sessions: sessions.map(s => ({
            code: s.code,
            date: s.tbmData.date,
            location: s.tbmData.workLocation,
            workContent: s.tbmData.workContent,
            participantCount: s.participants.length,
            riskCount: s.riskAssessments.length,
            status: s.status
        }))
    });
});

/**
 * 통계 조회
 * GET /api/companies/:companyId/stats
 */
app.get('/api/companies/:companyId/stats', (req, res) => {
    const { companyId } = req.params;

    const sessions = Array.from(database.sessions.values())
        .filter(s => s.companyId === companyId);

    const stats = {
        totalSessions: sessions.length,
        completedSessions: sessions.filter(s => s.status === 'completed').length,
        totalParticipants: sessions.reduce((sum, s) => sum + s.participants.length, 0),
        totalRisks: sessions.reduce((sum, s) => sum + s.riskAssessments.length, 0),
        averageRisksPerSession: sessions.length > 0
            ? (sessions.reduce((sum, s) => sum + s.riskAssessments.length, 0) / sessions.length).toFixed(1)
            : 0,
        risksByCategory: countRisksByCategory(sessions)
    };

    res.json({ success: true, stats });
});

function countRisksByCategory(sessions) {
    const categories = {};
    sessions.forEach(s => {
        s.riskAssessments.forEach(r => {
            const category = r.activity || '기타';
            categories[category] = (categories[category] || 0) + 1;
        });
    });
    return categories;
}

/**
 * AI 교육자료 상세 콘텐츠 생성
 * POST /api/generate-education-content
 *
 * 위험성평가 데이터를 기반으로 각 위험요인별 상세 교육 콘텐츠를 생성합니다.
 * - 유사 사고사례
 * - 원인 분석 (직접/간접/근본)
 * - 예방대책 (작업 전/중/후)
 * - 관련 법령
 */
app.post('/api/generate-education-content', async (req, res) => {
    const { risks, workContent, workLocation } = req.body;

    if (!risks || risks.length === 0) {
        return res.status(400).json({ error: '위험성평가 데이터가 필요합니다' });
    }

    try {
        const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

        if (CLAUDE_API_KEY) {
            // Claude API를 사용하여 상세 콘텐츠 생성
            const risksDescription = risks.map((r, i) =>
                `${i + 1}. 위험요인: ${r.hazard}, 작업내용: ${r.activity || workContent}, 안전대책: ${r.countermeasure}, 작업장소: ${r.location || workLocation}`
            ).join('\n');

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 8192,
                    messages: [{
                        role: 'user',
                        content: `당신은 한국 산업안전보건 전문가입니다. 다음 위험요인들에 대해 각각 상세한 안전교육 콘텐츠를 생성해주세요.

[작업 정보]
작업장소: ${workLocation || '건설 현장'}
작업내용: ${workContent || '일반 작업'}

[위험요인 목록]
${risksDescription}

각 위험요인에 대해 다음 정보를 JSON 형식으로 생성해주세요:

1. accidentCase: 실제 발생 가능한 유사 사고사례를 구체적으로 작성 (2-3문장, 연도/장소유형/작업자 나이/구체적 상황/결과 포함, 현실감 있게)
2. causeAnalysis: 사고원인 분석
   - directCause: 직접원인 (작업자의 불안전한 행동)
   - indirectCause: 간접원인 (불안전한 상태/환경)
   - rootCause: 근본원인 (관리적 원인)
3. detailedMeasures: 예방대책을 단계별로 작성
   - before: 작업 전 조치사항 (3-4개)
   - during: 작업 중 조치사항 (3-4개)
   - after: 작업 후 조치사항 (2-3개)
4. relatedLaw: 관련 안전 법규 (산업안전보건법, 산업안전보건기준에 관한 규칙 등 구체적 조항)

반드시 다음 JSON 형식으로 응답해주세요:
{
  "educationContents": [
    {
      "hazardIndex": 0,
      "accidentCase": "사고사례 설명...",
      "causeAnalysis": {
        "directCause": "직접원인...",
        "indirectCause": "간접원인...",
        "rootCause": "근본원인..."
      },
      "detailedMeasures": {
        "before": ["조치1", "조치2", "조치3"],
        "during": ["조치1", "조치2", "조치3"],
        "after": ["조치1", "조치2"]
      },
      "relatedLaw": "관련 법령..."
    }
  ]
}

모든 내용은 한국어로 작성하고, 사고사례는 최대한 현실감 있게 구체적으로 작성해주세요.`
                    }]
                })
            });

            const data = await response.json();
            try {
                const content = data.content[0].text;
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    console.log(`[교육 콘텐츠 AI 생성 완료] 위험요인: ${risks.length}건`);
                    return res.json({ success: true, ...parsed });
                }
            } catch (e) {
                console.error('AI 교육 콘텐츠 응답 파싱 오류:', e);
            }
        }

        // API 키가 없거나 파싱 오류 시 로컬 생성
        const educationContents = generateLocalEducationContent(risks, workContent, workLocation);
        console.log(`[교육 콘텐츠 로컬 생성] 위험요인: ${risks.length}건`);
        res.json({ success: true, educationContents });

    } catch (error) {
        console.error('교육 콘텐츠 생성 오류:', error);
        // 오류 시에도 로컬 생성으로 폴백
        try {
            const educationContents = generateLocalEducationContent(risks, workContent, workLocation);
            res.json({ success: true, educationContents });
        } catch (fallbackError) {
            res.status(500).json({ error: '교육 콘텐츠 생성 중 오류가 발생했습니다' });
        }
    }
});

/**
 * 로컬 교육 콘텐츠 생성 (AI 사용 불가 시 폴백)
 * 주요 위험유형별 사전 정의된 상세 콘텐츠
 */
function generateLocalEducationContent(risks, workContent, workLocation) {
    const hazardTemplates = {
        '추락': {
            accidentCase: `2024년 5월, ${workLocation || '○○건설 현장'}에서 ${workContent || '비계 해체작업'} 중 작업자(45세)가 높이 약 7m 지점에서 추락하여 중상을 입는 사고가 발생하였다. 해당 작업자는 안전대를 착용하였으나 걸이 설비에 체결하지 않은 상태에서 작업 중 발을 헛디뎌 추락하였으며, 작업발판이 규격 미달인 상태였다.`,
            causeAnalysis: {
                directCause: '안전대 미체결 상태에서 고소작업 수행',
                indirectCause: '작업발판 규격 미달, 안전난간 미설치',
                rootCause: '작업 전 안전점검 미실시, TBM 미실시, 안전관리자 감독 부재'
            },
            detailedMeasures: {
                before: ['안전대·안전모 착용 상태 상호 확인', '작업발판 및 안전난간 설치 상태 점검', '기상조건(강풍·강우·강설) 확인 후 작업 가능 여부 판단', '추락방지망 설치 상태 확인'],
                during: ['안전대 걸이 설비에 항시 체결 유지', '2인 1조 작업 실시', '개구부 접근 시 안전난간 확보 후 작업', '자재 운반 시 달비계·리프트 활용'],
                after: ['작업도구 및 잔재물 정리', '개구부 덮개 재설치 확인', '추락방지시설 이상 유무 최종 점검']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제42조(추락의 방지), 제44조(안전대의 부착설비 등)'
        },
        '감전': {
            accidentCase: `2024년 7월, ${workLocation || '○○공장'}에서 ${workContent || '전기배선 작업'} 중 작업자(38세)가 활선 상태의 전선을 접촉하여 감전 사고가 발생하였다. 해당 작업자는 절연장갑을 착용하지 않은 상태에서 분전함 내부 작업을 수행하던 중 충전부에 접촉하였으며, 차단기 미조작으로 통전 상태가 유지되고 있었다.`,
            causeAnalysis: {
                directCause: '절연용 보호구 미착용 상태에서 전기 작업 수행',
                indirectCause: '전원 미차단(LOTO 미실시), 활선 경고 표시 부재',
                rootCause: '정전작업 절차 미수립, 전기안전 교육 미실시'
            },
            detailedMeasures: {
                before: ['전원 차단(LOTO) 절차 실시 및 확인', '잔류전압 방전 확인(검전기 사용)', '절연장갑·절연화·절연매트 착용 확인', '작업구간 접지 실시'],
                during: ['활선 접근 금지구역 설정 및 준수', '절연 공구만 사용', '감시인 배치 및 상호 안전 확인', '젖은 손으로 전기설비 접촉 금지'],
                after: ['전원 복구 전 작업자 이격 확인', '잠금장치(LOTO) 해제 및 통전 확인', '절연저항 측정 및 이상 유무 확인']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제301조(전기 기계·기구 등의 충전부 방호), 제319조(정전 전로에서의 전기작업)'
        },
        '화재': {
            accidentCase: `2024년 3월, ${workLocation || '○○플랜트 현장'}에서 ${workContent || '용접 작업'} 중 비산된 불꽃이 인근 가연물에 착화되어 화재가 발생하였다. 용접 작업 반경 내에 보온재(우레탄폼)가 방치되어 있었으며, 소화기가 작업장에서 30m 이상 떨어진 곳에 비치되어 있어 초기 진화가 지연되었다.`,
            causeAnalysis: {
                directCause: '불꽃 비산 방지 조치 없이 용접작업 수행',
                indirectCause: '작업 반경 내 가연물 미제거, 소화설비 미비',
                rootCause: '화기작업 허가제 미이행, 화재감시자 미배치'
            },
            detailedMeasures: {
                before: ['화기작업 허가서 발급 및 검토', '작업 반경 11m 이내 가연물 제거', '방화포·불꽃 비산 방지막 설치', '소화기(ABC분말 2대 이상) 작업장 비치'],
                during: ['화재감시자 전담 배치', '용접 불꽃 비산 방향 지속 확인', '환기 상태 유지 및 가스 누출 감지', '주변 가연물 지속 감시'],
                after: ['용접 완료 후 30분 이상 잔불 감시', '작업장 주변 이상 발열 여부 확인', '소화기 사용 여부 확인 및 보충']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제241조(용접 등의 작업), 화재예방법 시행령 제5조(화기취급의 감독)'
        },
        '끼임': {
            accidentCase: `2024년 9월, ${workLocation || '○○제조공장'}에서 ${workContent || '컨베이어 벨트 정비작업'} 중 작업자(52세)의 손이 롤러와 벨트 사이에 끼이는 사고가 발생하였다. 장비 가동 중 이물질을 제거하려다 장갑이 말려 들어가면서 손가락이 협착되었으며, 비상정지 스위치가 작업자 접근 범위 밖에 있어 즉시 정지가 불가능했다.`,
            causeAnalysis: {
                directCause: '기계 가동 중 회전체 접근 및 이물질 제거 시도',
                indirectCause: '회전체 방호덮개 미설치, 비상정지장치 접근성 불량',
                rootCause: 'LOTO(잠금·표지) 절차 미수립, 정비작업 안전수칙 미교육'
            },
            detailedMeasures: {
                before: ['기계 정지 후 LOTO(잠금·표지) 실시', '회전체 방호덮개·안전가드 설치 확인', '비상정지 스위치 작동 상태 및 접근성 확인', '끼임 방지용 보호구(안전장갑) 적합성 확인'],
                during: ['운전 중 회전체 접근 절대 금지', '이물질 제거 시 반드시 기계 정지 후 실시', '면장갑 착용 금지(말려 들어감 위험)', '2인 1조 작업 및 감시인 배치'],
                after: ['방호장치 재설치 후 가동 재개', '장비 이상 유무 점검 및 기록']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제87조(회전기계의 돌출부), 제92조(덮개 등의 설치)'
        },
        '질식': {
            accidentCase: `2024년 6월, ${workLocation || '○○하수처리장'}에서 ${workContent || '맨홀 내부 점검작업'} 중 작업자(41세)가 산소결핍으로 의식을 잃고 쓰러졌다. 밀폐공간 내 산소농도가 16%로 위험 수준이었으나 사전 측정 없이 진입하였으며, 환기 조치도 미실시된 상태였다. 구조하러 들어간 동료 작업자도 함께 의식을 잃어 2명이 동시에 구조된 사고였다.`,
            causeAnalysis: {
                directCause: '산소농도 측정 없이 밀폐공간 진입',
                indirectCause: '환기설비 미설치, 구조용 장비 미비치',
                rootCause: '밀폐공간 작업 프로그램 미수립, 특별안전교육 미실시'
            },
            detailedMeasures: {
                before: ['밀폐공간 작업 허가 절차 이행', '산소농도(18% 이상) 및 유해가스 농도 측정', '충분한 환기 실시(30분 이상)', '비상구조 장비(송기마스크·구명밧줄) 비치'],
                during: ['연속 가스 농도 측정(실시간 모니터링)', '감시인 상주 배치(외부에서 감시)', '송기마스크 또는 공기호흡기 착용', '비상연락 체계 유지(유선통신)'],
                after: ['작업자 건강 상태 확인', '장비 회수 및 밀폐공간 출입금지 조치', '환기설비 철거 전 최종 가스 측정']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제618조(밀폐공간 작업 프로그램 수립 등), 제619조(밀폐공간 보건작업 프로그램)'
        },
        '넘어짐': {
            accidentCase: `2024년 11월, ${workLocation || '○○물류센터'}에서 ${workContent || '자재 운반 작업'} 중 작업자(36세)가 바닥에 흘린 기름에 미끄러져 넘어지면서 허리를 다치는 사고가 발생하였다. 통행로에 자재가 적치되어 있어 우회 이동 중 미끄러운 바닥을 인지하지 못하였다.`,
            causeAnalysis: {
                directCause: '바닥 오염물질(기름) 미인지 상태에서 보행',
                indirectCause: '통행로 자재 적치로 우회 보행, 바닥 미끄럼 방지 미조치',
                rootCause: '정리정돈 미흡, 안전통로 관리 기준 미수립'
            },
            detailedMeasures: {
                before: ['작업장 바닥 상태 점검 및 이물질 제거', '안전통로 확보 및 표시(노란색 라인)', '미끄럼 방지 안전화 착용 확인', '자재 적치 구역과 통행로 분리'],
                during: ['바닥 오염 발생 즉시 제거', '자재 운반 시 전방 주시', '경사로·계단 이동 시 손잡이 활용', '보행 속도 준수(뛰지 않기)'],
                after: ['작업장 정리정돈 실시', '바닥 청소 및 미끄럼 방지 조치 확인']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제3조(전도의 방지), 제22조(통로의 설치)'
        },
        '부딪힘': {
            accidentCase: `2024년 4월, ${workLocation || '○○건설현장'}에서 ${workContent || '굴착기 주변 작업'} 중 작업자(48세)가 선회하는 굴착기 붐에 부딪혀 부상을 입는 사고가 발생하였다. 장비 운전자의 사각지대에서 작업 중이었으며, 유도원이 배치되지 않은 상태였다.`,
            causeAnalysis: {
                directCause: '중장비 작업 반경 내 무단 진입',
                indirectCause: '유도원 미배치, 장비 작업반경 미설정',
                rootCause: '장비·인력 동시작업 안전계획 미수립'
            },
            detailedMeasures: {
                before: ['중장비 작업반경 설정 및 출입금지 구역 표시', '유도원(신호수) 배치 확인', '장비 경보장치(후진경보·선회경보) 작동 확인', '작업자-장비 운전원 신호체계 수립'],
                during: ['장비 작업반경 내 보행 금지', '장비 이동 시 유도원 신호에 따라 이동', '사각지대 접근 시 운전원에게 사전 연락', '중장비 접근 시 눈 맞춤 확인'],
                after: ['장비 주차 후 시동 차단 확인', '작업반경 내 잔여 인원 확인']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제196조(차량계 건설기계 등의 사용에 의한 위험 방지), 제38조(사전조사 및 작업계획서)'
        },
        '무너짐': {
            accidentCase: `2024년 8월, ${workLocation || '○○아파트 건설현장'}에서 ${workContent || '터파기 작업'} 중 굴착면이 붕괴하여 작업자(50세)가 매몰되는 사고가 발생하였다. 굴착 깊이 3m 이상이었으나 흙막이 가시설이 설치되지 않았으며, 연속 강우 후 지반이 약화된 상태에서 작업을 강행하였다.`,
            causeAnalysis: {
                directCause: '흙막이 가시설 미설치 상태에서 굴착면 접근',
                indirectCause: '강우 후 지반 약화, 굴착 기울기 미준수',
                rootCause: '가설구조물 설계·시공 미흡, 지반조사 미실시'
            },
            detailedMeasures: {
                before: ['지반조사 실시 및 토질 확인', '굴착 깊이에 맞는 흙막이 가시설 설계·설치', '강우 후 지반 상태 재점검', '굴착면 기울기 안전 기준 확인(토질별)'],
                during: ['굴착면 변위 관측(계측관리)', '중장비 굴착면 접근 제한', '작업자 대피로 확보', '이상 징후(균열·침하) 발생 시 즉시 대피'],
                after: ['굴착면 상태 최종 점검', '되메우기 또는 구조물 시공 전 안전 확인']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제338조(굴착작업시 지반 등의 위험 방지), 제339조(토석붕괴 위험 방지)'
        },
        '중량물': {
            accidentCase: `2024년 10월, ${workLocation || '○○조선소'}에서 ${workContent || '크레인을 이용한 중량물 인양 작업'} 중 와이어로프가 파단되면서 자재(약 2톤)가 낙하하여 하부 작업자(44세)가 중상을 입는 사고가 발생하였다. 와이어로프 안전계수 미달 상태에서 과적 인양을 시도하였으며, 인양물 하부 출입통제가 이루어지지 않았다.`,
            causeAnalysis: {
                directCause: '인양물 하부 출입통제 미실시',
                indirectCause: '와이어로프 마모·손상 상태에서 사용, 과적 인양',
                rootCause: '양중작업 계획서 미작성, 장비 정기검사 미실시'
            },
            detailedMeasures: {
                before: ['양중작업 계획서 작성 및 검토', '와이어로프·슬링벨트 상태 점검(마모·꼬임·절단)', '크레인 정격하중 확인 및 과부하방지장치 점검', '신호수(유도자) 지정 및 신호체계 수립'],
                during: ['인양물 하부 출입통제 철저', '신호수 신호에 따라 인양·이동', '인양 중 급선회·급정지 금지', '풍속 10m/s 이상 시 작업 중지'],
                after: ['인양장비 정위치 후 시동 차단', '와이어로프·체결기구 정리·보관', '작업반경 내 잔여 자재 확인']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제132조(양중기의 와이어로프 등), 제38조(사전조사 및 작업계획서)'
        },
        '베임': {
            accidentCase: `2024년 2월, ${workLocation || '○○금속가공 공장'}에서 ${workContent || '철판 절단 작업'} 중 작업자(33세)가 날카로운 절단면에 손을 베어 심부 열상을 입는 사고가 발생하였다. 보호장갑을 착용하지 않은 상태에서 절단된 철판 모서리를 맨손으로 취급하였다.`,
            causeAnalysis: {
                directCause: '보호장갑 미착용 상태에서 절단물 취급',
                indirectCause: '절단면 면취(디버링) 미실시, 날카로운 모서리 방치',
                rootCause: '절단물 취급 안전수칙 미교육, 보호구 착용 감독 미흡'
            },
            detailedMeasures: {
                before: ['절단 작업 전 방검장갑(케블라 등) 착용 확인', '절단 장비 안전장치 작동 상태 점검', '절단물 적치 장소 사전 확보', '구급함 비치 및 위치 확인'],
                during: ['절단면 즉시 면취(디버링) 처리', '날카로운 모서리에 보호캡 설치', '절단물 취급 시 반드시 방검장갑 착용', '절단 작업 시 신체 부위 절단선 접근 금지'],
                after: ['절단 잔재물 안전하게 수거·처리', '절단면 면취 상태 최종 확인']
            },
            relatedLaw: '산업안전보건기준에 관한 규칙 제118조(날·칼 부분의 방호), 산업안전보건법 제38조(안전조치)'
        }
    };

    // 기본 템플릿 (매칭되지 않는 위험요인용)
    const defaultTemplate = {
        accidentCase: `최근 ${workLocation || '○○작업현장'}에서 ${workContent || '작업'} 중 안전수칙 미준수로 인한 사고가 발생하였다. 작업자가 기본 안전수칙을 준수하지 않은 상태에서 작업을 수행하던 중 부상을 입었으며, 사전 안전교육 및 위험요인 점검이 충분히 이루어지지 않은 것이 원인으로 확인되었다.`,
        causeAnalysis: {
            directCause: '안전수칙 미준수 및 부주의한 작업 수행',
            indirectCause: '안전시설 미비, 작업환경 불량',
            rootCause: '안전관리 체계 미흡, 안전교육 부족'
        },
        detailedMeasures: {
            before: ['작업 전 TBM(Tool Box Meeting) 실시', '위험요인 사전 파악 및 안전대책 수립', '개인보호구 착용 상태 상호 확인', '비상연락망 및 대피경로 확인'],
            during: ['안전수칙 준수 여부 지속 확인', '이상 징후 발견 시 즉시 작업 중지', '2인 1조 작업 원칙 준수', '주변 작업자와 소통 유지'],
            after: ['작업장 정리정돈 실시', '장비·공구 이상 유무 점검', '잔여 위험요인 제거 확인']
        },
        relatedLaw: '산업안전보건법 제38조(안전조치), 제39조(보건조치)'
    };

    return risks.map((risk, index) => {
        // 위험요인 키워드 매칭
        const hazardText = (risk.hazard || '').toLowerCase();
        let template = null;

        for (const [keyword, tmpl] of Object.entries(hazardTemplates)) {
            if (hazardText.includes(keyword)) {
                template = tmpl;
                break;
            }
        }

        // 추가 키워드 매칭
        if (!template) {
            if (hazardText.includes('떨어') || hazardText.includes('높이') || hazardText.includes('고소')) template = hazardTemplates['추락'];
            else if (hazardText.includes('전기') || hazardText.includes('전류') || hazardText.includes('통전')) template = hazardTemplates['감전'];
            else if (hazardText.includes('화상') || hazardText.includes('용접') || hazardText.includes('불꽃')) template = hazardTemplates['화재'];
            else if (hazardText.includes('협착') || hazardText.includes('말림') || hazardText.includes('회전')) template = hazardTemplates['끼임'];
            else if (hazardText.includes('산소') || hazardText.includes('밀폐') || hazardText.includes('유해가스')) template = hazardTemplates['질식'];
            else if (hazardText.includes('미끄') || hazardText.includes('전도')) template = hazardTemplates['넘어짐'];
            else if (hazardText.includes('충돌') || hazardText.includes('접촉') || hazardText.includes('장비')) template = hazardTemplates['부딪힘'];
            else if (hazardText.includes('붕괴') || hazardText.includes('토사') || hazardText.includes('굴착')) template = hazardTemplates['무너짐'];
            else if (hazardText.includes('낙하') || hazardText.includes('인양') || hazardText.includes('크레인')) template = hazardTemplates['중량물'];
            else if (hazardText.includes('절단') || hazardText.includes('날카') || hazardText.includes('찔림')) template = hazardTemplates['베임'];
        }

        if (!template) template = defaultTemplate;

        return {
            hazardIndex: index,
            accidentCase: template.accidentCase,
            causeAnalysis: { ...template.causeAnalysis },
            detailedMeasures: {
                before: [...template.detailedMeasures.before],
                during: [...template.detailedMeasures.during],
                after: [...template.detailedMeasures.after]
            },
            relatedLaw: template.relatedLaw
        };
    });
}

// ============== 서버 시작 ==============
app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║     🎤 TBM 음성 AI 시스템 서버 시작        ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  📍 서버 주소: http://localhost:${PORT}        ║`);
    console.log('║  📁 API 문서: /api/health                  ║');
    console.log('╚════════════════════════════════════════════╝');
});

module.exports = app;
