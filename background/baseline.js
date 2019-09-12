const queryHelper = window.require('./query-helpers');
//Move baseline logic into classes and use an interface to here. This will allow different 
//algorithmes to be easily used fo clustering and scoring values
//

/*
* Compute baseline for Huawei 2G Cell level MOs
*/
async function computeHuaweiGCellBaselineScore(mo, parameter){
	const sql = `
INSERT INTO baseline.scores 
(vendor, technology, cluster, mo, parameter, value, score)
SELECT 
	'HUAWEI' as vendor,
	'2G' as technology,
    t3.data->>'SYSOBJECTID' AS "cluster",
    '${mo}' AS "mo",
    '${parameter}' AS "parameter",
    t1.data->>'${parameter}' as "value",
    COUNT(1) AS "score"
FROM 
huawei_cm."${mo}" t1
INNER JOIN huawei_cm."GCELL" t2 
    ON t2.data->>'CELLID' = t1.data->>'CELLID'
INNER JOIN huawei_cm."SYS" t3 
    ON t3.data->>'FILENAME' = T2.data->>'FILENAME'
GROUP BY 
    t3.data->>'SYSOBJECTID',
    t1.data->>'${parameter}'
ON CONFLICT ON CONSTRAINT unq_scores DO UPDATE SET 
  score=EXCLUDED.score + scores.score
	`
	
	log.info(sql)
	const result = await queryHelper.runQuery(sql);
	
}

/*
* Compute baseline for Huawei 3G Cell level MOs
*/
async function computeHuaweiUCellBaselineScore(mo, parameter){
	const sql = `
INSERT INTO baseline.scores 
(vendor, technology, cluster, mo, parameter, value, score)
SELECT 
	'HUAWEI' as vendor,
	'3G' as technology,
    t3.data->>'SYSOBJECTID' AS "cluster",
    '${mo}' AS "mo",
    '${parameter}' AS "parameter",
    t1.data->>'${parameter}' as "value",
    COUNT(1) AS "score"
FROM 
huawei_cm."${mo}" t1
INNER JOIN huawei_cm."UCELL" t2 
    ON t2.data->>'CELLID' = t1.data->>'CELLID'
INNER JOIN huawei_cm."SYS" t3 
    ON t3.data->>'FILENAME' = t2.data->>'FILENAME'
GROUP BY 
    t3.data->>'SYSOBJECTID',
    t1.data->>'${parameter}'
ON CONFLICT ON CONSTRAINT unq_scores DO UPDATE SET 
  score=EXCLUDED.score + scores.score
	`
	const result = await queryHelper.runQuery(sql);
	
}

//Compute baseline value for a BSC or RNC
async function computeHuaweiBaselineScore(tech, mo, parameter){
	let sql = `
INSERT INTO baseline.scores 
(vendor, technology, cluster, mo, parameter, value, score)
SELECT 
	'HUAWEI' as vendor,
	'${tech}' as technology,
    t2.data->>'SYSOBJECTID' AS "cluster",
    '${mo}' AS "mo",
    '${parameter}' AS "parameter",
    t1.data->>'${parameter}' as "value",
    COUNT(1) AS "score"
FROM 
huawei_cm."${mo}" t1
INNER JOIN huawei_cm."SYS" t2 
    ON t1.data->>'FILENAME' = t2.data->>'FILENAME'
GROUP BY 
    t2.data->>'SYSOBJECTID',
    t1.data->>'${parameter}'
ON CONFLICT ON CONSTRAINT unq_scores DO UPDATE SET 
  score=EXCLUDED.score + scores.score
	`
	
	if(tech === '4G'){
		sql = `
INSERT INTO baseline.scores 
(vendor, technology, cluster, mo, parameter, value, score)
SELECT 
	'HUAWEI' as vendor,
	'${tech}' as technology,
    t2.data->>'TAC' AS "cluster",
    '${mo}' AS "mo",
    '${parameter}' AS "parameter",
    t1.data->>'${parameter}' as "value",
    COUNT(1) AS "score"
FROM 
huawei_cm."${mo}" t1
INNER JOIN huawei_cm."CNOPERATORTA" t2 
	AND t2.data->>'FILENAME' = t1.data->>'FILENAME'
GROUP BY 
    t3.data->>'TAC',
    t1.data->>'${parameter}'
ON CONFLICT ON CONSTRAINT unq_scores DO UPDATE SET 
  score=EXCLUDED.score + scores.score
		`;
	}
	const result = await queryHelper.runQuery(sql);
}

/*
* Update the baseline comparison report query
*/
async function updateBaselineComparisonQuery(){
	
	
	const res = await queryHelper.runQuery('SELECT DISTINCT cluster FROM  baseline.values ORDER BY 1');
	const clusterColStr = "\"" + res.rows.map(v => v.cluster).join('","') + "\""
	const clusterCtStr = "\"" + res.rows.map(v => v.cluster).join('" character varying,"') + "\" character varying"
	
	const sql = ` 
UPDATE reports.reports  
SET 
	query = \$\$
SELECT 
    vendor as "VENDOR", 
    technology AS "TECHNOLOGY", 
    mo AS "MO", 
    parameter AS "PARAMETER", 
	baseline AS "BASELINE_VALUE",
    ${clusterColStr} 
FROM 
crosstab( 
' 
SELECT 
    RANK() OVER (ORDER BY t1.vendor, t1.technology, t1.mo, t1.parameter, t1.cluster)::int AS row_name, 
    t1.vendor, 
    t1.technology, 
    t1.mo, 
    t1.parameter, 
	t2.baseline as baseline, 
    t1.cluster as category,  
    t1.value as "value" 
from 
baseline.values t1 
LEFT join baseline.configuration t2 
    ON t2.vendor = t1.vendor 
    AND t2.technology  = t1.technology 
    AND t2.mo  = t1.mo 
    AND t2.parameter = t1.parameter 
order by 1', 
' 
SELECT 
    DISTINCT cluster 
FROM 
    baseline.values 
ORDER BY 1 
' 
) 
AS  
ct( 
row_name int, 
vendor character varying, 
technology character varying, 
mo character varying, 
parameter character varying, 
baseline character varying, 
${clusterCtStr} 
) 
\$\$ 
WHERE id = ( SELECT id as rpt_id FROM reports.reports WHERE name = 'Baseline Comparison' ) 
	`
	log.info(sql)
	await queryHelper.runQuery(sql);
}

/*
* Cluster network based on provided algorithm
*
* @param string algorithm Clustering algorithm
*/
async function clusterNetwork(algorithm){
	
}


async function computeScores(scoreAlgo){
	//Select MOs and parameters from baseline.configuration
	const results = await queryHelper.runQuery("SELECT * FROM baseline.vw_configuration")
	const rows = results.rows 
	if(rows.length > 0){
		for(let v of rows) {
			log.info(`Processing vendor:${v.vendor} tech:${v.technology} mo:${v.mo} parameter:${v.parameter}`)

			//HUAWEI - technology = 2G or 3G
			if(v.vendor === 'HUAWEI'){
				await computeHuaweiBaselineScore(v.technology, v.mo, v.parameter);
			}
		}
	}
}



/*
* Compute baseline value for each cluster, mo, and parameter
*/
async function computeBaselineValues(){
	log.info("Computing baseline values...")
	const sql = `
	INSERT INTO baseline.values 
	(cluster, vendor, technology, mo, parameter, "value")
	SELECT cluster, vendor, technology, mo, parameter, value
	FROM baseline.scores t1
	WHERE
	score = (
			SELECT MAX(score)
			FROM baseline.scores t2
			WHERE 
				t2.vendor = t1.vendor
				and t2.technology = t1.technology 
				and t2.cluster = t1.cluster
				and t2.mo = t1.mo 
				and t2.parameter = t1.parameter 
	)		
		
	`
	log.info(sql);
	
	await queryHelper.runQuery(sql);
	
	log.info("Computing baseline value done.")
}

/*
* Upload/import user baseline 
*
* This is the operator baseline to use for auditing network
* 
* @param string baselineFile Full path to baseline file
* @param boolean truncate Whether to truncate the table before importing the data 
*/
async function uploadUserBaseline(baselineFile, truncate){
	
	let parameterList = ['vendor', 'technology', 'mo', 'parameter', 'baseline'];
	let paramIndices = []
	
	//Add exclude logic
	let updatePhrase = parameterList.map( p => `${p} = EXCLUDED.${p}`);
	
	if(truncate === true ){
		queryHelper.runQuery('TRUNCATE TABLE baseline.configuration RESTART IDENTITY');
	}
	
	console.log(`baselineFile: ${baselineFile}`);
	
	await new Promise((resolve, reject) => {
		csv({output: "csv", noheader:true, trim:true})
		.fromFile(baselineFile)
		.subscribe(async (csvRow, index)=>{
			
			//Header column 
			if(index === 0){
				//parameterList = csvRow;
				
				//Populate parameter indices 
				//only consider values in the parameterList i.e with a filter
				paramIndices = parameterList
					.map(v => v.toLowerCase())
					.map( v => csvRow.indexOf(v)).filter(v => v > -1)
				
				return;
			}
			
			let values = paramIndices.map(v => csvRow[v])
			
			const sql = `INSERT INTO baseline."configuration"
				(${parameterList.join(",")})
			VALUES
				('${values.join("','")}')
			 ON CONFLICT ON CONSTRAINT unq_configuration DO UPDATE
			 SET 
				${updatePhrase.join(",")}
			`;
			
			log.log(sql);
			await queryHelper.runQuery(sql);
			
		},(err) => {//onError
			log.error(`csvJoJson.onError: ${err.toString()}`);
			resolve();
		},
		()=>{//onComplete
			log.info(`End of csvToJson for ${baselineFile}.`)
			resolve();
		});
	});//eof: promise
}


/*
* Auto generate parameter reference 
* 
*/
async function autoGenerateParameterRef(clearTableBefore){
	
	if(clearTableBefore === true ){
		await queryHelper.runQuery("TRUNCATE TABLE telecomlib.parameter_reference");
	}
	
	const VENDOR_CM_INFO = [
		{
			vendor: "HUAWEI",
			cm_schema: "huawei_cm"
		},
		{
			vendor: "ERICSSON",
			cm_schema: "ericsson_cm"
		},
		{
			vendor: "NOKIA",
			cm_schema: "nokia_cm"
		},
		{
			vendor: "ZTE",
			cm_schema: "zte_cm"
		}
	];
	
	for(let v of VENDOR_CM_INFO){		
		const colSql = `SELECT DISTINCT table_name 
		FROM information_schema.tables 
		WHERE  table_schema  = '${v.cm_schema}' 
		AND table_type = 'BASE TABLE'`;
		console.log(colSql);
		const colSqlRes = await queryHelper.runQuery(colSql);
		console.log("colSqlRes:", colSqlRes)
		
		for( let t of colSqlRes.rows){
			const sql = `
			INSERT INTO telecomlib.parameter_reference 
			(vendor, technology, mo, parameter_id, parameter_name, granulity)
			SELECT 
				'${v.vendor}' as vendor, 
				 COALESCE(t2.technology,'UNKNOWN') AS technology,
				'${t.table_name}' as mo,
				key as parameter_id,
				key as parameter_name,
				COALESCE(t2.granulity, 'UNKNOWN') as granulity
				
			FROM (
				SELECT DISTINCT jsonb_object_keys(data)  AS key
				FROM
				${v.cm_schema}."${t.table_name}"
			) t1
			LEFT JOIN  telecomlib.managed_objects t2 
				ON t2.vendor = '${v.vendor}' 
				AND t2.mo = '${t.table_name}'
			WHERE 
				t2.technology IS NOT NULL
			ON CONFLICT ON CONSTRAINT unq_parameter_reference DO NOTHING
			`;
			
			
		console.log(sql);
		await queryHelper.runQuery(sql);
		}
		
	}
}


/*
* Upload/import parameter reference   
*
* @param string fileName Full path to parameter reference file
* @param boolean truncate Whether to truncate the table before importing the data 
*/
async function uploadParameterReference(fileName, truncate){
	
	let parameterList = ['vendor', 'technology', 'mo', 'parameter_id', 'parameter_name', 'is_key', 'granulity', 'description'];
	let paramIndices = []
	
	//Add exclude logic
	let updatePhrase = parameterList.map( p => `${p} = EXCLUDED.${p}`);
	
	if(truncate === true ){
		queryHelper.runQuery('TRUNCATE TABLE telecomlib.parameter_reference RESTART IDENTITY');
	}
	
	console.log(`Parameter reference file: ${fileName}`);
	
	await new Promise((resolve, reject) => {
		csv({output: "csv", noheader:true, trim:true})
		.fromFile(fileName)
		.subscribe(async (csvRow, index)=>{
			
			//Header column 
			if(index === 0){
				//parameterList = csvRow;
				
				//Populate parameter indices 
				//only consider values in the parameterList i.e with a filter
				paramIndices = parameterList
					.map(v => v.toLowerCase())
					.map( v => csvRow.indexOf(v)).filter(v => v > -1)
				
				return;
			}
			
			let values = paramIndices.map(v => csvRow[v])
			
			const sql = `INSERT INTO telecomlib."parameter_reference"
				(${parameterList.join(",")})
			VALUES
				('${values.join("','")}')
			 ON CONFLICT ON CONSTRAINT unq_configuration DO UPDATE
			 SET 
				${updatePhrase.join(",")}
			`;
			
			log.log(sql);
			await queryHelper.runQuery(sql);
			
		},(err) => {//onError
			log.error(`csvJoJson.onError: ${err.toString()}`);
			resolve();
		},
		()=>{//onComplete
			log.info(`End of csvToJson for ${fileName}.`)
			resolve();
		});
	});//eof: promise
}

/*
* Compute baseline
* 
* @param string clustering Clustering algorithm 
* @param string scoring Scoring algorithm
*/
async function computeBaseline(clustering, scoring){
	//Clear previous scores
	await queryHelper.runQuery("TRUNCATE TABLE baseline.scores RESTART IDENTITY");
	await queryHelper.runQuery("TRUNCATE TABLE baseline.values RESTART IDENTITY");
	
	//Cluster network
	await clusterNetwork(clustering);
	
	//Compute scores 
	await computeScores(scoring);
	
	//Compute baseline values from scores 
	await computeBaselineValues()
	
	//Update baseline comparison query 
	await updateBaselineComparisonQuery();

}

exports.computeBaseline = computeBaseline;
exports.clusterNetwork  = clusterNetwork ;
exports.uploadUserBaseline  = uploadUserBaseline ;
exports.uploadParameterReference = uploadParameterReference;
exports.autoGenerateParameterRef = autoGenerateParameterRef;