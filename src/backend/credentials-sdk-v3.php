<?php
require 'vendor/autoload.php';

use Aws\Sts\StsClient;

// AWS settings
$accessKeyId = 'YOUR_ACCESS_KEY';
$secretAccessKey = 'YOUR_SECRET_KEY';

$key = $_POST['key'];
$bucket = 'YOUR_BUCKET';
$folder = 'YOUR_FOLDER';
$region = 'YOUR_REGION'; // us-west-1, eu_west-2, etc...

$signatureVersion = 'YOUR_SIGNATURE_VERSION'; // v2, v3 or v4
$roleArn = 'arn:aws:iam::xxxxxxxx:role/YOUR_ROLE_NAME';
$apiVersion = '2011-06-15';

// Setup policy
$path = $bucket.'/'.$folder;
$policy = json_encode([
    'Version' => '2012-10-17',
    'Statement' => [
        'Sid' => 'randomstatementid'.time(),
        'Effect' => 'Allow',
        'Action' => [
            's3:AbortMultipartUpload',
            's3:PutObject'
        ],
        'Resource' => 'arn:aws:s3:::'. $path.'/*'
    ],
]);

// Generate temporary credentials
$client = StsClient::factory([
    'credentials' => [
        'key'    => $accessKeyId,
        'secret' => $secretAccessKey
    ],
    'apiVersion' => $apiVersion,
    'signatureVersion' => $signatureVersion,
    'region' => $region
]);
$result = $client->assumeRole([
    'RoleArn' => $roleArn,
    'RoleSessionName' => 'test',
    'Policy' => $policy,
    'DurationSeconds' => 3600,
])->get('Credentials');

$result['Key'] = $key;
echo json_encode($result);

die(json_encode([
    'region' => $region,
    'bucket' => $bucket,
    'Key' => $key,
    'AccessKeyId' => $result['AccessKeyId'],
    'SecretAccessKey' => $result['SecretAccessKey'],
    'SessionToken' => $result['SessionToken']
]));
