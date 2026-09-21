# Vercel 배포

`vercel.json`은 `/`을 고객 화면으로 보내고, `api/bootstrap.py`, `api/state.py`,
`api/action.py`를 Python 함수로 배포한다. 기존 `python3 app/server.py` 로컬 실행도 유지한다.

## 공유 저장소 연결

Vercel 프로젝트의 Storage에서 전용 Upstash Redis 데이터베이스를 연결하고 다음 환경변수를
Production 및 Preview에 설정한다. 값은 Git에 커밋하지 않는다.

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

기존 Vercel KV 형식인 `KV_REST_API_URL`, `KV_REST_API_TOKEN`도 지원한다.
저장소가 없으면 상태/액션 API는 명확한 503 오류를 반환하며 인스턴스 메모리로 대체하지 않는다.
초기 상품 정보인 `/api/bootstrap`은 저장소 없이도 응답한다.

기본 키는 `gs-ai-live:g-24:production:v1`이며 Preview는 배포 URL별로 격리된다.
특정 키가 필요할 때만 `GS_STATE_KEY`를 지정한다. 데이터는 마지막 성공 요청 후 24시간 동안 유지된다.
같은 배포의 고객 A/B/C와 Director는 하나의 데모 방송 상태를 공유한다.

저장할 때 Redis의 비교 후 쓰기를 사용해 동시 요청의 변경 유실을 방지한다.
서버마다 다른 monotonic 시계 대신 Redis의 시각을 사용한다. 저장 데이터는 명시적 타입만
복원하는 JSON이며 실행 가능한 직렬화 형식은 사용하지 않는다.

이 앱은 가상 고객 시연용이다. 기존 Vercel Deployment Protection을 유지한다.
실제 사용자 인증·방송별 권한을 구현한 서비스로 간주하면 안 된다.

## 빌드

```sh
python3 scripts/build_vercel.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

정적 출력은 `public/`이다. 고객/Director HTML·CSS·JS와 화면에 쓰이는 이미지·영상만 복사한다.
서버 소스, 테스트, 로컬 도구, 자격 증명은 정적 출력에 포함하지 않는다.
함수 번들에는 코드·Fixture와 작은 영상 manifest를 남기고 큰 미디어는 CDN으로 제공한다.

Vercel의 Framework Preset은 `Other`이며 저장소 설정을 사용한다. Root Directory는 저장소 루트다.
환경변수를 연결한 후 다시 배포한다.

## 배포 후 확인

1. `/`이 `/app/customer.html`로 이동한다.
2. `/api/bootstrap`, `/api/state`가 JSON으로 응답한다.
3. 고객 화면에서 사이즈·질문을 입력하고 Director에서 반영을 확인한다.
4. 고객 페이지를 새로 열어도 선택과 방송 run ID가 유지된다.
5. `/app/server.py`, `/tests/test_app_state.py`는 공개 파일로 제공되지 않는다.

Functions에 세 Python 엔드포인트가 표시되어야 한다. 정적 파일만 나열되면 새 배포의
설정과 브랜치를 확인한다. Vercel 로그인으로 이동하는 것은 Deployment Protection 동작이다.

참고: [Python 함수 경로](https://vercel.com/docs/functions/runtimes/python/api-directory),
[Upstash REST API](https://upstash.com/docs/redis/features/restapi).
