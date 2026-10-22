-- The landing page's Recommendations, in the order shown, edited from the admin page (PUT /api/admin/recommendations).
-- Title, channel and thumbnail are stored so the landing page needs no YouTube call. addedBy is the admin who added
-- the song; null for the seed
create table "recommendation" (
  "videoId" text not null primary key,
  "title" text not null,
  "author" text not null,
  "thumbnailUrl" text not null,
  "position" integer not null,
  "addedBy" text,
  "addedAt" integer not null
);

-- The 32 songs of YouTube playlist PLzJ1mqwxogpFxKR72a6M8br_UkLKFQASf on 2026-10-22, in playlist order, with the
-- titles and channels the YouTube Data API gave the landing page and its 480x360 ("high") thumbnail
insert into "recommendation" ("videoId", "title", "author", "thumbnailUrl", "position", "addedBy", "addedAt") values
  ('Q5JytNgQzqk', 'Novelbright - 愛とか恋とか [Official Music Video]', 'Novelbright', 'https://i.ytimg.com/vi/Q5JytNgQzqk/hqdefault.jpg', 0, null, 1792627200000),
  ('ZRtdQ81jPUQ', 'YOASOBI「アイドル」 Official Music Video', 'YOASOBI', 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/hqdefault.jpg', 1, null, 1792627200000),
  ('VyvhvlYvRnc', 'YOASOBI「優しい彗星」Official Music Video　(YOASOBI - Comet)', 'YOASOBI', 'https://i.ytimg.com/vi/VyvhvlYvRnc/hqdefault.jpg', 2, null, 1792627200000),
  ('sOiMD45QGLs', '【Ado】ギラギラ', 'Ado', 'https://i.ytimg.com/vi/sOiMD45QGLs/hqdefault.jpg', 3, null, 1792627200000),
  ('3mDuYk3lg0I', 'かわにしなつき ｰ 理想的ガール（Official Music Video）', 'かわにしなつき', 'https://i.ytimg.com/vi/3mDuYk3lg0I/hqdefault.jpg', 4, null, 1792627200000),
  ('oZpYEEcvu5I', 'tuki.『晩餐歌』Official Music Video', 'tuki.(17)', 'https://i.ytimg.com/vi/oZpYEEcvu5I/hqdefault.jpg', 5, null, 1792627200000),
  ('kfpGkUFW-aM', 'CHIHIRO - 冷たくしないでよ（Official MV）', 'CHIHIRO official', 'https://i.ytimg.com/vi/kfpGkUFW-aM/hqdefault.jpg', 6, null, 1792627200000),
  ('LEjZ3lJPzN0', '藍悼花 -aitouka- / 酔シグレ feat.Lucia', 'Lucia', 'https://i.ytimg.com/vi/LEjZ3lJPzN0/hqdefault.jpg', 7, null, 1792627200000),
  ('sWff60PZytQ', 'tayori - 風のたより (Official Video)', 'tayori', 'https://i.ytimg.com/vi/sWff60PZytQ/hqdefault.jpg', 8, null, 1792627200000),
  ('8KwqvUKYkPg', '【第75回紅白歌合戦歌唱曲】『EYES ON YOU』MV Full', '西野カナ Official YouTube Channel', 'https://i.ytimg.com/vi/8KwqvUKYkPg/hqdefault.jpg', 9, null, 1792627200000),
  ('iw_1zU2MSc8', '西野カナ『トリセツ』MV Full', '西野カナ Official YouTube Channel', 'https://i.ytimg.com/vi/iw_1zU2MSc8/hqdefault.jpg', 10, null, 1792627200000),
  ('K1Tz2yNmamI', 'YOASOBI「もう少しだけ」Official Music Video', 'YOASOBI', 'https://i.ytimg.com/vi/K1Tz2yNmamI/hqdefault.jpg', 11, null, 1792627200000),
  ('lEoDjtCm488', '『触れていたいだけ』/ MIMI feat. 月  (Music Video)', 'MIMI', 'https://i.ytimg.com/vi/lEoDjtCm488/hqdefault.jpg', 12, null, 1792627200000),
  ('bLUqO8cboMw', 'スノードーム / 『ユイカ』【MV】', '『ユイカ』', 'https://i.ytimg.com/vi/bLUqO8cboMw/hqdefault.jpg', 13, null, 1792627200000),
  ('m34Hj7msTio', 'Aimer「月影」Lyric Video', 'Aimer Official YouTube Channel', 'https://i.ytimg.com/vi/m34Hj7msTio/hqdefault.jpg', 14, null, 1792627200000),
  ('40dJS_LC6S8', 'ウォルピスカーター MV 『泥中に咲く』', 'ウォルピス社', 'https://i.ytimg.com/vi/40dJS_LC6S8/hqdefault.jpg', 15, null, 1792627200000),
  ('I5eu4XMWZR8', 'Soala - すれ違い 【Official Music Video】', 'Soala Channel', 'https://i.ytimg.com/vi/I5eu4XMWZR8/hqdefault.jpg', 16, null, 1792627200000),
  ('kxs9Su_mbpU', 'Aimer 『カタオモイ』MUSIC VIDEO（FULL ver.）', 'Aimer Official YouTube Channel', 'https://i.ytimg.com/vi/kxs9Su_mbpU/hqdefault.jpg', 17, null, 1792627200000),
  ('PYgHThU84yU', 'マルシィ – 未来図（Official Music Video）', 'マルシィ', 'https://i.ytimg.com/vi/PYgHThU84yU/hqdefault.jpg', 18, null, 1792627200000),
  ('4DxL6IKmXx4', 'LiSA 『炎』 -MUSiC CLiP-', 'LiSA Official YouTube', 'https://i.ytimg.com/vi/4DxL6IKmXx4/hqdefault.jpg', 19, null, 1792627200000),
  ('WAMxwRtNrPY', 'Novelbright - ツキミソウ [Official Music Video]', 'Novelbright', 'https://i.ytimg.com/vi/WAMxwRtNrPY/hqdefault.jpg', 20, null, 1792627200000),
  ('6rG_irmOQsM', 'やさしいひとたち。『一生の運を』Official Video', 'やさしいひとたち。', 'https://i.ytimg.com/vi/6rG_irmOQsM/hqdefault.jpg', 21, null, 1792627200000),
  ('aOKa-5AHCtU', '【Ado】向日葵', 'Ado', 'https://i.ytimg.com/vi/aOKa-5AHCtU/hqdefault.jpg', 22, null, 1792627200000),
  ('Hmvjp4xw7dA', 'tuki.『シーソー』Official Music Video', 'tuki.(17)', 'https://i.ytimg.com/vi/Hmvjp4xw7dA/hqdefault.jpg', 23, null, 1792627200000),
  ('FVZJJ2v1Zys', '春を待つ / Islet feat.倚水', 'tayori', 'https://i.ytimg.com/vi/FVZJJ2v1Zys/hqdefault.jpg', 24, null, 1792627200000),
  ('GK2iXm-Dloo', 'BAK『不言論』Official Music Video', 'CHIMERAZ(キメラズ) CHANNEL', 'https://i.ytimg.com/vi/GK2iXm-Dloo/hqdefault.jpg', 25, null, 1792627200000),
  ('3Fz17pPuI4k', '幾田りら「百花繚乱」 Official Music Video', '幾田りら / Lilas Official', 'https://i.ytimg.com/vi/3Fz17pPuI4k/hqdefault.jpg', 26, null, 1792627200000),
  ('2qEhos64JBI', 'BAK『＝ (feat. YO_CO)』Official Music Video', 'CHIMERAZ(キメラズ) CHANNEL', 'https://i.ytimg.com/vi/2qEhos64JBI/hqdefault.jpg', 27, null, 1792627200000),
  ('l5K9exFxEnI', 'tuki. 『騙シ愛』Official Audio（TBS系日曜劇場「キャスター」主題歌）', 'tuki.(17)', 'https://i.ytimg.com/vi/l5K9exFxEnI/hqdefault.jpg', 28, null, 1792627200000),
  ('I0wRx6C758o', '當山みれい 『春夏秋冬 reprise』Lyric Video', '當山みれい / MIREI', 'https://i.ytimg.com/vi/I0wRx6C758o/hqdefault.jpg', 29, null, 1792627200000),
  ('agstsXgsxg4', 'tuki.『孤独の鯨』Official Music Video', 'tuki.(17)', 'https://i.ytimg.com/vi/agstsXgsxg4/hqdefault.jpg', 30, null, 1792627200000),
  ('ysdtX8kRTuQ', 'LiSA『残酷な夜に輝け』MUSiC CLiP', 'LiSA Official YouTube', 'https://i.ytimg.com/vi/ysdtX8kRTuQ/hqdefault.jpg', 31, null, 1792627200000);
