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
app.use(express.static(path.join(__dirname, '../frontend'))); // 프론트엔드 파일 제공

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
