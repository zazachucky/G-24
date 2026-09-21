# 미결정 항목 해결 기록

결정일: 2026-09-21. 사용자의 자율 해결 요청에 따라 데모 기본값을 확정하고 자료를 준비했다.
확정 상태는 아래 파일과 실행 결과를 기준으로 하며, 아직 없는 앱 UI의 구현 완료를 뜻하지 않는다.

| 기존 항목 | 확정·준비 결과 | 상태 | 산출물 |
| --- | --- | --- | --- |
| 개인 Need | 같은 고객·방송·상품, 30초 내 서로 다른 SIZE 신호 2종. event_id 중복 제외. 최초 감지 1회 | 규칙·reference 검증 완료 | [규칙](need-director-rules.md), [코드](../prototype/need_director.py) |
| 집단 Spike | 직전/현재 각60초 신규 감지 고유 고객 비교. 현재10명 이상·이전2배 이상. 8→26(+225%)를 Fixture로 재현 | 규칙·reference 검증 완료 | [시나리오](../fixtures/director-scenario.json) |
| PD 개인화 | 승인 시 최근120초 고객 snapshot, 거절 고객 제외. 내 사이즈 버튼만 강조. 5분TTL, 상품전환·거절 시 해제 | 규칙·reference 검증 완료 | [규칙](need-director-rules.md) |
| 대화 처리 | 운영자 공용, 고객 질문·AI 답변 개인. SIZE는Direct Result. 미지원·영상·지연 응답 정책 고정 | 명세·답변 데이터 준비 완료 | [대화정책](conversation-policy.md), [답변](../fixtures/ask-live.json) |
| 최종 샘플 데이터 | 1,200건 채택, 선택형리뷰5항목 실제API 확인, 사이즈표8실측항목, 메인이미지13장, 혜택준비값·배송Mock 구분 | 준비·데이터 검증 완료 | [상품](../fixtures/main-product.json), [데모설정](../fixtures/demo-config.json), [출처](product-data-sources.md) |
| 코디 콘텐츠 | 실제 하의8·신발6, 최종3Look, 실제상품카드 이미지, 사전생성Lookbook3장 | 준비·파일연결 검증 완료 | [후보](../fixtures/styling-candidates.json), [Look](../fixtures/styling-looks.json), [출처](styling-sources.md) |
| 영상 | 사용자가 상품 이미지 기반 데모, 실제영상 추후연결 선택. 영상AI 비활성화 | 현재범위 결정 완료 / 실제영상·AI 검증 보류 | [데모설정](../fixtures/demo-config.json) |
| 통합 검수 | A포함·B/C제외,33명승인,8→26,거절·중복·경계·만료. UI검수표20항목과시연순서 작성 | 로직·자료 검증 완료 / 앱 UI 검수 대기 | [검수표](acceptance-checklist.md), [검증결과](verification-report.json) |

## 확정한 데이터와 예외

- 실제상품 원본은 [GS SHOP 1084192893](https://m.gsshop.com/prd/prd.gs?prdid=1084192893)이다. 실시간 수집 없이 확인시점의 자료를 사용한다.
- 선택형리뷰는 공개API로 재검증했다. 문서상 `미재확인` 상태를 해소했으며 실제비율을 그대로 보존한다.
- 전체리뷰1,200과 항목별응답합계1,202는 원본응답의 차이다. 원인을 추측하거나 분모를 통일하지 않는다.
- 제조사 두께 가이드와 고객 리뷰는 다르다. 두께 답변은 `구매자 리뷰 기준`이라고 명시한다.
- 그레이66은 확인시점의 실제페이지에서 일시품절이다. 데모의66추천은 유지하고 구매는 시뮬레이션임과 실제옵션상태를 함께 표시한다.
- 혜택45,515원은 가상고객 준비값, 배송2~3영업일은 명시적인Mock이다. 실제고객조회결과로 표현하지 않는다.
- Director의ALERT26은 감지고객수, RESULT26은 준비된반복질문건수다. 지표를 혼용하지 않는다.
- 코디는 실제판매사진과AI코디예시를 분리한다. 생성이미지가 상품디테일을 정확히 재현한다고 보장하지 않는다.

## 검증과 남은 범위

```sh
python3 scripts/validate_demo.py --write-report
python3 -m unittest discover -s tests -p 'test_need_director.py' -v
python3 prototype/need_director.py
```

자료·규칙을 앱에 연결하고 고객/PD UI에서 검수표를 실행하는 작업은 다음 구현 단계다.
사용자가 보류한 실제영상 연결과 영상AI PASS 판정은 현재 완료범위에 포함하지 않는다.
현재 결정·자료 준비를 위해 추가 사용자 답변이 필요한 항목은 없다.
