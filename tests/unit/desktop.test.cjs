const {test}=require('node:test'), assert=require('node:assert/strict');
const {DesktopClient}=require('../../dist/test/desktop/client');

test('desktop discovery distinguishes missing installation from an installed stopped application',async()=>{
  await assert.rejects(new DesktopClient(async()=>({executable:null,candidates:[]})).addresses(),{code:'DSH_DESKTOP_NOT_INSTALLED'});
  await assert.rejects(new DesktopClient(async()=>({executable:'D:\\Apps\\DeepSeek Harness.exe',candidates:[]})).addresses(),{code:'DSH_DESKTOP_NOT_RUNNING'});
  assert.deepEqual(await new DesktopClient(async()=>({executable:'D:\\Apps\\DeepSeek Harness.exe',candidates:[{pid:12,port:3456}]})).addresses(),[{pid:12,port:3456}]);
});
