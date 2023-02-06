import puppeteer from 'puppeteer';
import fs from 'fs/promises'

const URLS = [

]

main()
async function main() {
    const cookies = JSON.parse(await fs.readFile('COOKIE'))
    const browser = await puppeteer.launch({
        headless: false, defaultViewport: {
            width: 1700,
            height: 1080
        }
    });
    const page = await browser.newPage();

    const acceptBeforeUnload = dialog =>
        dialog.type() === "beforeunload" && dialog.accept()
        ;
    page.on("dialog", acceptBeforeUnload);

    await page.setCookie(...cookies)

    let ARR = []
    await page.exposeFunction("addArr", (item) => { ARR.push(item) });

    for (const URL of URLS) {
        await page.goto(URL, { waitUntil: 'load' });
        const jobTitle = await page.evaluate(() => document.querySelector('.jobsearch-JobInfoHeader-title')?.innerHTML.match(/<.*>([a-zA-Z ]+)/)[1] || new Date().toLocaleString())
        const company = await page.evaluate(() => document.querySelector('div[data-company-name]').innerHTML || '')
        //check apply button is disabled
        const isApplyCompanySite = await page.evaluate(() => /Apply on company site/i.test(document.querySelector('#applyButtonLinkContainer')?.innerHTML))
        if (isApplyCompanySite) {
            await fs.appendFile('COMPANY_URLS', '\n' + JSON.stringify({ url: URL }) + ',')
            continue
        }
        const isApplyDisabled = await page.evaluate(() => document.querySelector('#indeedApplyButton')?.hasAttribute('disabled'))
        if (isApplyDisabled) {
            await fs.appendFile('ERROR_URLS', '\n' + JSON.stringify({ msg: 'applied', url: URL }) + ',')
            continue
        }
        await page.click('#indeedApplyButton')
        // await page.waitForNavigation()



        let intervalId
        let preUrl
        await new Promise((resolve, reject) => {
            intervalId = setInterval(async () => {
                try {

                    ARR = []
                    const currentUrl = await page.evaluate(() => document.location.href);
                    if (currentUrl == preUrl) {
                        throw new Error('fail submitting')
                    }
                    else preUrl = currentUrl
                    await page.evaluate(evaluate)
                    console.log(ARR);
                    for (const { id, classname, checked, value, selectValue } of ARR) {
                        if (id) {
                            if (selectValue) await page.select('#' + id, selectValue)
                            if (checked) await page.click('#' + id)
                            if (value) await page.type('#' + id, value)
                        }

                    }
                    const isSubmitAppBtn = await page.evaluate(() => /Submit your application/i.test(document.querySelector('.ia-continueButton')?.innerHTML))
                    await page.click('.ia-continueButton')
                    if (isSubmitAppBtn) {
                        await page.screenshot({ path: [jobTitle, company].join('-') + '.png', type: 'png', fullPage: true });
                        await fs.appendFile('SUCCESS_URLS', '\n' + JSON.stringify({ url: URL }) + ',')
                        clearInterval(intervalId)
                        resolve()
                    }

                } catch (error) {
                    clearInterval(intervalId)
                    resolve()
                    console.log('EXIT INTERVAL', error.message);
                    await fs.appendFile('ERROR_URLS', '\n' + JSON.stringify({ msg: error.message, url: URL, }) + ',')
                }

            }, 3000)
        })
    }







    // setInterval(async() => {
    //     const cookies = await page.cookies();
    //     fs.writeFile('COOKIE',JSON.stringify(cookies),(err)=>{
    //         if(err)console.error('err writing cookies')
    //         else console.log('cookies wrote to file')
    //     })
    // }, 10000);


    console.log('done');

}

function evaluate() {
    const TYPES = [
        {
            regex: /authorized to work in the United States|eligible to work in the United states/i,
            checked: true
        },
        {
            regex: /no sponsor|not sponsor/i,
            checked: true
        },
        {
            regex: /require visa/i,
            checked: false
        },
        {
            regex: /sms/i,
            checked: false
        },
        {
            regex: /Ethnicity/i,
            select: /asian/i
        },
        {
            regex: /country/i,
            select: /united states/i
        },
        {
            regex: /gender/i,
            checked: true
        },
        {
            regex: /Contact Method/i,
            checked: true
        },
        {
            regex: /read and accept/i,
            checked: true
        },

        {
            regex: /salary/i,
            value: '90000'
        },
        {
            regex: /python|type ?script|java ?script|node( .)?(js)?|react( .)?(js)?|web|server/i,
            checked: true
        },
        {
            regex: /sql/i,
            value: '2'
        },
    ]
    const elements = document.querySelectorAll('.ia-Questions-item')

    for (const el of elements) {
        let useDefault = true
        if (/optional/i.test(el.innerHTML)) continue
        for (const { regex, checked, value, select } of TYPES) {
            if (!regex.test(el.innerHTML)) continue
            const textarea = el.querySelector('textarea')
            if (select) {
                const selectEl = el.querySelector('select')
                const options = el.querySelectorAll('option')
                for (const option of options) {
                    if (select.test(option.innerHTML)) {
                        const obj = {}
                        const id = selectEl.id
                        const classes = selectEl.classList
                        if (id) obj.id = id
                        else if (classes?.length) selectEl.classname = classes[0]
                        obj.selectValue = option.value
                        addArr(obj)
                        useDefault = false
                        break
                    }
                }
            }
            else if (textarea) {
                const obj = {}
                const input = textarea
                const id = input.id
                const classes = input.classList
                if (id) obj.id = id
                else if (classes.length) input.classname = classes[0]
                obj.value = value
                addArr(obj)
                useDefault = false
            }
            else {
                const inputs = el.querySelectorAll('input')
                if (!inputs.length) continue
                if (inputs[0].type === 'radio') {
                    // select yes
                    for (const input of inputs) {
                        if (checked && /1|Yes|true/i.test(input.value)) {
                            input.click()
                            useDefault = false

                        }
                        else if (/0|no|false/i.test(input.value)) {
                            input.click()
                            useDefault = false
                        }
                    }
                }
                else if (['text', 'number'].includes(inputs[0].type)) {
                    const obj = {}
                    const input = inputs[0]
                    const id = input.id
                    const classes = input.classList
                    if (id) obj.id = id
                    else if (classes.length) input.classname = classes[0]
                    obj.value = value
                    addArr(obj)
                    useDefault = false
                    // inputs[0].value = value
                }

            }

        }

        if (useDefault) {
            const inputs = el.querySelectorAll('input')
            if (!inputs.length) continue
            if (inputs[0].type === 'radio') {
                // select no
                for (const input of inputs) {
                    if (input.value == '0') {
                        input.click()
                    }
                }
            }
            else if (inputs[0].type == 'text' && !inputs[0].value) {
                const obj = {}
                const input = inputs[0]
                const id = input.id
                const classes = input.classList
                if (id) obj.id = id
                else if (classes.length) input.classname = classes[0]
                obj.value = 'N/A'
                addArr(obj)
            }
        }
    }
}

async function wait(time) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, time)
    })
}