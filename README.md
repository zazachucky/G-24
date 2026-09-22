# GS AI LIVE 로컬 프로토타입

고객용 모바일 화면을 최신 요청에 맞춰 개선했습니다. 흰색·차콜을 기본으로, AI 코디/ASK LIVE는 보라색, 혜택가는 코랄색으로 구분합니다. 원본 상품 사진·리뷰·코디 이미지를 재사용하며 런타임 이미지 생성이나 실제 결제는 없습니다.

## 실행

Node.js 22 이상 권장. 외부 패키지 설치 없이 실행합니다.

```bash
git clone https://github.com/zazachucky/G-24.git
cd G-24
npm start
```

- [고객 Mobile](http://127.0.0.1:4173/mobile.html)
- [Director](http://127.0.0.1:4173/director.html)

기본 포트는 4173입니다. 이미 서버가 실행 중이면 재실행 대신 새로고침하세요. 다른 포트는 `PORT=4175 npm start`로 지정합니다. 고객/Director를 같은 브라우저의 같은 주소(origin)로 열어야 공통 이벤트가 전달됩니다.

## 저장소 교체와 배포

사용자 요청에 따라 이전 Python/API 앱을 이 Node.js + 정적 HTML/CSS/JavaScript 프로토타입으로 교체했습니다. 기존 버전은 Git 이력의 `f72372b0d12e00f5ad0321ce13b1f3fbb69c826c`에 보존되어 있습니다. 원래 로컬 작업 폴더와 제출용 세션 로그는 수정하거나 업로드하지 않았습니다.

Vercel은 `npm ci --ignore-scripts` → `npm run build` → `dist/` 정적 배포를 사용합니다. `vercel.json`의 build/output 설정은 [공식 배포 설정](https://vercel.com/docs/project-configuration/vercel-json)에 맞췄습니다. 이전 `/app/customer.html`, `/app/director.html` 링크는 새 화면으로 리디렉션합니다. 루트(`/`)는 두 화면을 여는 시작 페이지입니다. 로컬 정적 빌드 검사는 `npm run test:build`로 실행합니다.

이 교체는 기존 Python API·서버 공통 상태·외부 저장소 연결을 유지하지 않습니다. 배포된 화면도 **같은 브라우저·같은 origin 안에서만** IndexedDB로 공유하며 다른 기기 간 연동은 없습니다. 배포 origin이 달라지면 별도 상태입니다. 실제 Vercel 배포 성공은 Git push 후 연결된 프로젝트의 결과를 확인해야 하며, 로컬 빌드 통과와는 별개입니다.

## 고객 화면 시연 (약 3분)

첨부 이미지와 비교해 추가한 기능은 [기능 대조표와 증거](docs/feature-gap-audit.md)에 정리했습니다. 라이브 대화 오버레이·장바구니, ASK 리뷰 그래프, 사이즈 근거, 추가 혜택 조건, 코디 썸네일/전체 상품, Director 질문 TOP 5와 승인 완료 상세를 포함합니다.

1. 상단 LIVE 영역의 제공 MP4를 재생합니다. **다른 상품 참고 영상**임을 표시합니다. 영상 안의 `확장해서 보기`로 좌측 영상·상품 / 우측 대화 배치로 전환하고 `세로로 보기`로 돌아옵니다. 작은 화면의 상품·대화 영역은 세로로 스크롤합니다.
2. 사이즈 77을 선택하고 질문을 입력만 한 상태에서 전환해보세요. 선택·입력값·대화·AI 응답 대기·영상 재생 상태는 같은 상태/DOM을 사용합니다.
3. 보라색 `지수님을 위한 코디 추천` → 오피스/데이트/데일리 3종을 확인합니다. 이미지 아래로 스크롤하면 추천 이유와 실제 상품 사진·GS SHOP 링크가 있습니다. 데님의 판매 상품과 스니커즈는 미확정이라 링크하지 않습니다.
4. `내 사이즈`: 평소 66, 잘 맞아요 87%, 반사이즈 상향 안내 → 사이즈 상세 → 66 선택 후 구매 체험. `내 혜택`: 49,900 − 2,495 − 1,890 = **45,515원**, 총 할인 4,385원.
5. 빠른 질문 4종을 눌러 통합 대화의 고객/ASK LIVE 답변을 확인합니다. 자유 질문의 미지원 정보(모델 착용 사이즈 등)는 한계를 안내합니다. 배송 일정은 가상 예시입니다.
6. `이용 안내 → 시연 초기화 → 새 방송 시작` 후 `사이즈표 → 사이즈 리뷰 확인`을 30초 안에 수행하고 상세를 닫습니다. 작은 제안의 `확인하기`는 내 사이즈, `괜찮아요`는 같은 방송에서 재노출 금지입니다. 새로고침해도 거절이 유지되고 내 사이즈 직접 조회는 허용됩니다.
7. 하단 `구매하기` → 선택 옵션/혜택 확인 → 구매 체험 완료. 실제 주문·결제·배송은 발생하지 않습니다.

질문 입력창과 구매 버튼은 스크롤 영역 밖에 배치했습니다. 소프트 키보드에 대해서는 visualViewport 높이를 반영합니다. 실제 iOS/Android 기기의 키보드·안전 영역 검수는 별도로 필요합니다.

## Director 연동 확인 (기존 기능 유지)

고객 화면과 Director는 같은 브라우저·같은 origin의 IndexedDB 공통 상태를 사용합니다. 트랜잭션으로 동시 변경을 처리하고 BroadcastChannel/저장소 알림으로 화면을 갱신합니다. localStorage는 기존 데이터 이관·호환용이며 서버·다른 기기·실제 방송 시스템 연동은 아닙니다. **두 화면을 모두 새로고침**해야 같은 버전의 연결 로직을 사용합니다.

Director의 `실제 고객 반응 · Mobile 연동`에서 사이즈·혜택·코디 이용, 선택 옵션·코디, 장바구니 수량/합계, 영상 상태, 구매 흐름 진입/체험 완료를 확인할 수 있습니다. `효과 분석`에는 APP 승인 후 실제 행동 증분도 고정 Simulation 결과와 별도로 표시합니다. Mobile의 `이용 안내`에서는 승인된 안내문·APP 상태·Simulation 결과·강조 만료를 볼 수 있습니다. [양방향 연동 대조표와 증거](docs/data-sync-audit.md)

1. Director `공통 Reset` → 고객 `사이즈표 → 사이즈 리뷰 확인`.
2. 실제 고객 UI 이벤트를 근거로 Need 감지. 집단 관심 **8→26**과 **대상 33명**은 고정 Simulation 수치이며 실제 시청자 집계가 아닙니다.
3. Director `호스트 승인`, `APP 33명 승인` → A 포함/B·C 제외, 고객 제안에 `PD 승인` 표시와 내 사이즈 강조. 고객은 승인 전에도 행동 기반 작은 제안을 볼 수 있습니다(최신 모바일 요청 우선). 이미 수락/거절한 제안은 승인해도 다시 띄우지 않습니다.
4. `Simulation 결과` → 결과 표시 및 30초 강조 만료. `강조 만료 검수`로 수동 확인도 가능합니다. Reset 후 반복합니다.

## 검증

```bash
npm test                 # 공통 reducer: 30초 경계, 중복/거절, 만료, 저장소 실패 등
npm run verify           # 별도 4174 포트: HTTP, 이미지, JS/CSS, MP4 Range
npm run test:build       # 정적 배포 파일 일치, 비공개 자료 제외, 이전 경로 리디렉션 설정
# npm start가 실행 중인 상태에서:
npm run test:browser     # 임시 Chrome으로 실제 클릭·텍스트 입력·작은 화면·3회 연동
npm run test:video       # 재생/정지/탐색/방향 전환/오류 대체·복구
npm run test:features    # 이미지에서 추가한 기능 + Director 본문 승인 흐름
npm run test:sync        # 양방향 필드·영상·실제 집계·Reset 경합·동시 80건 입력
```

브라우저 검수는 macOS 기본 Chrome 경로를 사용합니다. 다른 환경에서는 `CHROME_PATH`를 지정하세요. `APP_URL`로 대상 서버 주소를 변경할 수 있습니다. 검수마다 별도 임시 프로필을 만들고 자신이 만든 프로필만 삭제합니다. 사용자의 브라우저 데이터는 건드리지 않습니다.

브라우저 검수 명령은 순서대로 실행하는 것을 권장합니다. 실제 30초 만료 검수가 포함되어 있어 여러 Chrome 검수를 동시에 실행하면 지연 중 만료 버튼이 먼저 비활성화될 수 있습니다.

- [검수 결과와 제한](docs/mobile-validation.md)
- [고객 검수 보고서](artifacts/mobile/report.json), [화면 캡처](artifacts/mobile/)
- [영상 검수 보고서](artifacts/video-layout/report.json)

## 구현 위치와 자료 보존

- `public/mobile.html`, `mobile.css`, `mobile.js`: 고객 UI, 공유 방향 상태, 준비된 응답/구매 흐름
- `public/gs-live-data.js`, `assets/mobile/`: 제공 HTML에서 추출한 동일 상품·리뷰·후보·코디 데이터/이미지
- `public/gs-live-config.js`: 공통 상품 옵션·혜택가·코디 이름
- `public/gs-ai-live-state.js`: 공통 reducer/IndexedDB 트랜잭션/탭 알림, 30초 Need 규칙, 수락·거절·기한·실제 집계
- `public/director.html`, `director.js`, `director-features.css`: Director 본문/질문 집계/승인 기록. 승인·Need는 공통 reducer 하나만 사용합니다.
- `public/gs-ai-live-integration.js`: 이전 화면용 legacy bridge 보존본. 현재 Mobile/Director는 로드하지 않습니다.
- `assets/reference-video.mp4`: 제공 MP4
- `reference/`: 첨부 원본 HTML 및 `mobile-before-redesign.html`, `director-before-features.html` 보존

명세 우선순위는 최신 사용자 모바일 요청 → 제공 `GS_AI_LIVE_Prototype_Developer_Handoff_v1.0.md` → 참고 HTML입니다. 이전에 언급된 `docs/GS_AI_LIVE_Goal_Prompt.md`는 이 작업 경로에 없으며, 이번 작업은 실제 제공된 명세와 자료를 사용했습니다.

## 실제 서비스 연결이 필요한 부분

- 인증된 고객 프로필·상품/옵션/재고·최신 가격·혜택 API
- 근거 검증 및 안전장치를 갖춘 실제 ASK LIVE/코디 추천 서비스
- 실시간 방송·자막·채팅 transport, 서버 이벤트 수집·동의·보관 정책
- PD 승인/대상 판정/고객 세션 간 동기화, 실제 집계와 성과 측정
- 주문·결제·배송 API (현재 화면은 데모)
- 미확정 데님·스니커즈 판매 상품 확정, 기존 후보의 판매 상태·색상·재고 확인
- **TODO/미검증:** 영상 AI, 장면 검색, 상품 동일성 판정, 모델 착용 사이즈 추출. 현재 시연 기능으로 제공하지 않음
