此目录也可放置 Cesium terrain 格式的 DEM 数据。

前端会优先探测 /terrain/layer.json，若不存在则继续探测 /dem/layer.json。

注意：浏览器端当前不直接读取原始 .dem / .tif 栅格文件，
请先转换为 Cesium terrain 目录结构后再放入本目录。
