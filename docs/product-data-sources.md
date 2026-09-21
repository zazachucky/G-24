# 메인 상품 데이터 검증 기록

2026-09-21 공개 GS SHOP 상품 페이지, 공개 구매정보 API, 공개 리뷰 API를 로그인 없이 확인했다. 데모는 이 시점의 [고정 데이터](../fixtures/main-product.json)와 로컬 이미지를 읽는다. 현재 판매가·재고·리뷰가 이후 변경되어도 발표 중 자동으로 바뀌지 않는다. 각 응답의 확인 시각은 fixture의 `sources.*.verified_at`에 기록했다.

## 확인한 출처

| 출처 ID | 공개 URL | 확인한 항목 |
| --- | --- | --- |
| `product_page` | [GS SHOP 상품 1084192893](https://m.gsshop.com/prd/prd.gs?prdid=1084192893) | 상품명, 브랜드, 판매가 49,900원, 평점 4.5, 리뷰 1,200개, 현재 옵션 응답, 상품 이미지 8장, 무료배송 |
| `buying_info` | [공개 상품 구매정보](https://m.gsshop.com/prd/prdBuyingInfo.gs?prdid=1084192893&format=json) | 소재, 제조사, 색상, 세탁, 55/66/77/88 실측 사이즈표, 반사이즈 안내, 제조사 착용 가이드 |
| `review_api` | [공개 리뷰 집계](https://m.gsshop.com/product/api/revw/v0/reviewMain/1084192893?mseq=397078&prsnInclYn=Y&prsnFilterYn=N) | 리뷰 1,200개, 평점 4.5, 디자인·사이즈·색상·두께·핏 선택형 평가 비율 |

공개 페이지가 로드하는 [getItems_ui.js](https://public.m-gs.kr/ui/gsshop/product/main/script/vue/getItems_ui.js?20260918150100)의 `fetchBuyingInfo`와 `fetchReview`에서 조회 주소를 확인했다. 인증이나 개인화 파라미터를 추가하지 않았다. Fixture에는 개별 작성자 ID, 고객번호, 리뷰 원문을 넣지 않고 상품 데이터와 집계만 보존했다.

## Handoff와 달라진 값 및 유지한 값

- Handoff §7의 리뷰 수 1,199는 문서 작성 당시 값으로 보존하고, 공개 상품 페이지와 리뷰 API에서 함께 확인한 **1,200**을 데모에 사용한다.
- Handoff §8의 선택형 평가 비율은 공개 리뷰 API에서 모두 일치했다. 따라서 `document_provided_unverified`가 아닌 **`actual_snapshot`**이다.
- 49,900원은 확인한 판매가다. 45,515원은 별도 `demo-config.json`의 준비된 개인 혜택 예시이며 공개 판매가 검증 결과와 섞지 않는다.
- 실제 도착 예정일은 확인하지 못했다. 무료배송만 실제 값이며, 준비된 배송 날짜·소요일은 `배송 시뮬레이션`으로 표시한다.

| 평가 | 공개 API에서 확인한 비율 | 합계 |
| --- | --- | --- |
| 디자인 | 좋아요 68 / 보통이에요 31 / 별로예요 1 | 100% |
| 사이즈 | 잘 맞아요 87 / 작아요 7 / 커요 6 | 100% |
| 색상 | 동일해요 91 / 생각보다 어두워요 6 / 생각보다 밝아요 2 | 99% |
| 두께 | 얇아요 63 / 적당해요 35 / 두꺼워요 2 | 100% |
| 핏 | 보통이에요 68 / 슬림핏이에요 30 / 오버핏이에요 1 | 99% |

비율을 100%에 맞춰 보정하지 않는다. 공개 API의 각 항목별 응답 수 합계는 **1,202**로 전체 리뷰 수 **1,200**과 다르다. 이 차이의 원인은 확인하지 못했다. 두 원본 값을 그대로 보존하며, 리뷰 수를 분모로 비율을 재계산하거나 1,202명을 고유 응답자 수로 해석하지 않는다.

제조사 가이드는 두께를 `약간 두꺼움`으로 표시하지만, 구매자 선택형 리뷰에서는 `얇아요`가 63%다. 서로 다른 출처의 판단이다. ASK LIVE 답변은 **“구매자 리뷰 기준으로 63%가 얇아요라고 답했어요”**처럼 출처를 드러낸다.

## 이미지와 색상 매핑

실제 이미지 8장을 다운로드하고 모두 직접 열어 확인했다. 색상명은 [공식 상세 색상 안내](https://static.m-gs.kr/image/10/84/1084192893_1756201378416_1.jpg)와 대조했다. 이미지별 원본 URL·SHA-256·확인 시각은 fixture에 있다.

| 색상 | 착용 이미지 | 단품 이미지 | 용도 |
| --- | --- | --- | --- |
| 그레이 | [gallery-01.jpg](../assets/products/main/gallery-01.jpg) | [gallery-05.jpg](../assets/products/main/gallery-05.jpg) | 기본 데모 화면 / Lookbook 생성 시 상의 reference |
| 블랙 | [gallery-02.jpg](../assets/products/main/gallery-02.jpg) | [gallery-06.jpg](../assets/products/main/gallery-06.jpg) | 상품 설명 및 색상 탐색 |
| 크림 | [gallery-03.jpg](../assets/products/main/gallery-03.jpg) | [gallery-07.jpg](../assets/products/main/gallery-07.jpg) | 상품 설명 및 색상 탐색 |
| 라벤더 | [gallery-04.jpg](../assets/products/main/gallery-04.jpg) | [gallery-08.jpg](../assets/products/main/gallery-08.jpg) | 공식 상품 이미지 보존; 현재 옵션 응답에는 미포함 |

이미지가 있다고 현재 구매 가능한 옵션이라고 해석하지 않는다. 현재 옵션 응답에는 그레이 55/66/77/88, 블랙 55/66/77/88, 크림 55/66이 있다. 라벤더 및 다른 크림 사이즈가 없는 이유는 확인하지 못했다. `colors.present_in_current_option_response`도 재고 보유 여부를 의미하지 않는다.

공개 상품 HTML의 실제 `<option>` 표시를 추가로 확인했다. **그레이 66은 확인 당시 `일시품절`이다.** `option[data-attrPrdCd="1084192893002"]`에 `data-soldout="Y"`가 있고 문구도 `그레이 / 66 (일시품절)`로 표시된다. 그레이 77/88, 크림 55/66도 같은 표시다. 그레이 55와 블랙 55/66/77/88에는 품절 표시가 없다. 이것은 구매 성공을 보장하는 재고 검증이 아닌, 확인한 페이지의 옵션 상태다.

따라서 원본 `stockFlg=Y`는 이 상품 HTML에서 일시품절 표시와 대응하며, `N`은 일시품절 표시가 없는 옵션과 대응한다. 각 옵션에 `raw_stock_flag`, `page_sold_out`, `page_label`, HTML selector와 확인 시각을 함께 기록했다. 실시간 재고 조회나 결제를 실행하지 않았으므로 `availability`는 여전히 `null`이다.

**고정 데모의 66 사이즈 안내는 유지하지만 그레이 66을 실제 구매 가능 옵션처럼 표시하지 않는다.** 준비된 선택으로 구매 흐름을 보여줄 때는 구매 시뮬레이션임을 표시한다. 실제 상품 링크로 이동할 때는 `그레이 66은 확인 당시 일시품절`을 안내하고 현재 옵션을 상품 페이지에서 확인하도록 한다. 이 차이는 fixture의 `demo_size_stock_note`에도 기록했다.

착용 이미지의 하의·액세서리는 촬영용 코디이며 메인 판매 구성은 풀오버 1종이다. 실제 Styling 추천 상품의 근거는 별도 Styling fixture다.

## 실제 사이즈표

[상품 상세의 사이즈표 이미지](../assets/products/main/detail-11.jpg)를 확보한 뒤 공개 구매정보 API의 숫자와 대조했다. 아래는 신체 치수가 아닌 **의류 실측**, 단위는 cm다.

| 항목 | 55 | 66 | 77 | 88 |
| --- | --- | --- | --- | --- |
| 총길이 | 60 | 61 | 62 | 63 |
| 어깨너비 | 35 | 36 | 37 | 38 |
| 목너비 | 18.5 | 19 | 19.5 | 20 |
| 목깊이 | 7 | 7.5 | 8 | 8.5 |
| 가슴단면 | 42.5 | 45 | 47.5 | 50 |
| 밑단단면 | 43 | 45.5 | 48 | 50.5 |
| 소매길이 | 60 | 60.5 | 61 | 61.5 |
| 소매부리단면 | 8.5 | 9 | 9.5 | 10 |

[공식 색상·사이즈 안내 이미지](../assets/products/main/detail-02.jpg)는 `반사이즈 위로`를 안내한다. 구매정보 API의 `halfSize: B`도 [공개 UI 코드](https://public.m-gs.kr/ui/gsshop/product/main/script/vue/components/components.min.js?20260918150100)에서 `크게`로 렌더링되는 것을 확인했다. 이를 정밀 체형 추천으로 확대 해석하지 않는다.

소재는 구매정보에 표시된 캐시미어 85% / 나일론 10% / 폴리에스터 5%이며, 가이드의 소재감은 [그레이 상세 이미지](../assets/products/main/detail-10.jpg)에서 확인할 수 있다.

## 다시 확인하는 방법

`python3 scripts/fetch_product_data.py --output-dir /tmp/gs-ai-live-main-source --download-images`

표준 Python 라이브러리만 사용하는 준비용 도구다. 네트워크 접근이 필요하며, 결과는 임시 디렉터리에 저장한다. 개인 리뷰 기록을 제외한 공개 집계와 상품 데이터만 남긴다. 기존 fixture를 자동 덮어쓰지 않으므로 변경값과 이미지 매핑을 확인한 뒤 고정 데이터를 갱신할 수 있다. 데모 실행에 이 도구나 공개 API 연결은 필요하지 않다.
